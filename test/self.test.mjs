// kit-139: project/self.md, what the project is; plain since kit-862 (self@2, its own checks in
// test/self-plain.test.mjs and test/self-plain-cases.test.mjs; a version 1 file on main still validates). The supervisor drafts it from the code and
// the strategy; the strategy links it rather than restating it. self show and self check read it,
// validate refuses one that breaks the contract, a part's path is checked at the draft only (on main a
// missing one raises self-drift), a capitalised word that main's strategy and dependency files don't
// contain holds a draft on a repo not known to be private until the supervisor names it on its chore
// (--names-checked), and metrics raises self-unlinked and self-missing. Each assertion names its
// check (C1…) in the spec's acceptance table.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { json, kit as KIT, write } from './lib/kit.mjs';
import { fixture, SUP } from './lib/next-step-fixture.mjs';
import { checkSelf as refCheckSelf } from './fixtures/world2/check.mjs';

const P = 'docs/devteam/project';
const SELF = `${P}/self.md`;
const STRAT = `${P}/strategy.md`;
const EXT = `${P}/exterior.md`;
const world = (f) => fs.readFileSync(new URL(`./fixtures/world/${f}`, import.meta.url), 'utf8');
const world2 = (f) => fs.readFileSync(new URL(`./fixtures/world2/${f}`, import.meta.url), 'utf8');
// the plain self.md (self@2) and its strategy; version 1's self.md and its dashboard block
const SELF_MD = world2('self.md');
const STRATEGY = world2('strategy.md');
const V1 = world('self.md');
const DATA = JSON.parse(world('dashboard-data.json'));
const CASES = JSON.parse(world('invalid/cases.json')).filter((c) => c.file.startsWith('self-'));
// the paths the plain self.md's parts link (cases.json's, its docs/ the fixture's docs/devteam/), and version 1's, as files on main
const PARTS = Object.fromEntries(JSON.parse(world2('cases.json')).paths.map((p) => [`docs/devteam/${p.slice('docs/'.length)}`, 'x\n']));
const V1_PARTS = { 'app/main.js': 'app\n', 'app/plugins/api.js': 'api\n', 'sync/server.js': 'sync\n', 'deploy/sync.yml': 'deploy\n' };
const SRC = fs.readFileSync(path.join(KIT, 'scripts', 'devteam.mjs'), 'utf8');
const re = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
// self.md with a paragraph added; version 1's with its block's what changed
const withProse = (extra) => SELF_MD.replace('It controls its code', `${extra}\n\nIt controls its code`);
const v1What = (what) => V1.replace('"what": "A note app for independent researchers that keeps every note as plain text."', `"what": ${JSON.stringify(what)}`);

// A fixture project: main holds strategy (null: init's template), self.md (null: none) and the
// parts' files; a gh on PATH answers `gh repo view acme/quillmark` with the visibility set (unknown, or
// any other repo: it fails).
function proj(name, { strategy = STRATEGY, self = SELF_MD, files = PARTS, visibility = 'unknown' } = {}) {
  const F = fixture(name);
  const { old, g } = F;
  const bin = path.join(F.base, 'bin');
  const visFile = path.join(F.base, 'visibility');
  // while this file exists gh hangs, as a slow or offline gh does
  const slowFile = path.join(F.base, 'slow');
  // origin reads as a GitHub repo (as the kit asks gh about it by name), and git still reaches the bare one
  g(['config', `url.${F.org}.insteadOf`, 'https://github.com/acme/quillmark.git'], old);
  g(['remote', 'set-url', 'origin', 'https://github.com/acme/quillmark.git'], old);
  write(path.join(bin, 'gh'), `#!/bin/sh\nif [ -e '${slowFile}' ]; then exec sleep 30; fi\ncase "$*" in *acme/quillmark*) ;; *) exit 1 ;; esac\nif [ "$1 $2" = "repo view" ] && [ -s '${visFile}' ]; then cat '${visFile}'; exit 0; fi\nexit 1\n`);
  fs.chmodSync(path.join(bin, 'gh'), 0o755);
  const setVisibility = (v) => fs.writeFileSync(visFile, v === 'unknown' ? '' : `${v.toUpperCase()}\n`);
  const setSlow = (on) => (on ? fs.writeFileSync(slowFile, '') : fs.rmSync(slowFile, { force: true }));
  setVisibility(visibility);
  const ENV = { ...SUP, PATH: `${bin}${path.delimiter}${process.env.PATH}` };
  const run = (args, env = ENV) => { const r = F.run(old, args, env); return { status: r.status, out: r.out, err: r.err, text: `${r.out}\n${r.err}` }; };
  const ok = (args) => { const r = run(args); assert.equal(r.status, 0, `${args.join(' ')}\n${r.text}`); return r.out; };
  const onMain = (changes, msg = 'main') => {
    for (const [rel, text] of Object.entries(changes)) {
      if (text === null) fs.rmSync(path.join(old, rel), { recursive: true, force: true });
      else write(path.join(old, rel), text);
    }
    g(['add', '-A'], old);
    g(['commit', '-qm', msg, '--allow-empty'], old);
    g(['push', '-q', 'origin', 'main'], old);
  };
  onMain({ ...(strategy === null ? {} : { [STRAT]: strategy }), ...(self === null ? {} : { [SELF]: self }), ...files }, 'fixture');
  const blob = (rel) => g(['rev-parse', `origin/main:${rel}`], old);
  // a chore whose worktree change(w) edits; its head, or null when chore pr refused
  const chorePr = (slug, change, more = [], env = ENV) => {
    const w = path.join(old, '.worktrees', `chore-${slug}`);
    if (!fs.existsSync(w)) ok(['chore', 'start', slug]);
    change(w);
    const r = run(['chore', 'pr', slug, '--title', `${slug} draft`, ...more], env);
    return { ...r, w, sha: () => g(['rev-parse', 'HEAD'], w), pushed: () => g(['ls-remote', 'origin', `refs/heads/chore-${slug}`], old) !== '' };
  };
  // any branch (plan/<f>, ticket/<id>, a refactor's chore) carrying changes, pushed, with its PR file
  const branchOf = (branch, change) => {
    const w = path.join(old, '.worktrees', branch.replace('/', '-'));
    g(['worktree', 'add', '-q', '-b', branch, w, 'origin/main'], old);
    change(w);
    g(['add', '-A'], w);
    g(['commit', '-qm', branch], w);
    g(['push', '-q', 'origin', branch], w);
    write(path.join(old, 'docs/devteam/run/pr', `${branch}.md`), `# ${branch.replace('/', '-')}: x\n\n## One-way doors\n\nNone.\n`);
    return g(['rev-parse', 'HEAD'], w);
  };
  const body = path.join(F.base, 'pr-body.md');
  write(body, 'x\n\n## One-way doors\n\nNone.\n');
  const checkPr = (headRef, sha) => run(['check-pr', '--head-ref', headRef, '--sha', sha, '--title', `${headRef}: x`, '--body-file', body]);
  const findings = (kind) => json(ok(['metrics', '--json'])).findings.filter((f) => f.kind === kind);
  const rmPath = (w, rel) => fs.rmSync(path.join(w, rel), { recursive: true, force: true });
  return { ...F, run, ok, onMain, blob, chorePr, branchOf, checkPr, findings, setVisibility, setSlow, rmPath, ENV };
}

// the live log's lines (none yet: no folder)
const logLines = (W) => { const d = path.join(W.old, 'docs/devteam/run/log'); return fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.endsWith('.jsonl')).flatMap((f) => fs.readFileSync(path.join(d, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))) : []; };
// Each check is a subtest of its fixture's test, so one red check leaves the next to run (and be
// seen red on its own).
const withProject = (name, opts, body) => async (t) => {
  const W = proj(name, opts);
  try { await body(W, (title, fn) => t.test(title, fn)); } finally { W.done(); }
};

test('self show, --json, dashboard-data, search and governance read main\'s self.md (DW1)', withProject('self-show', {}, async (W, check) => {
  await check('C1 self show prints main\'s self.md as it is', () => {
    const s = W.run(['self', 'show']);
    assert.equal(s.status, 0, `C1 self show exits 0\n${s.text}`);
    assert.ok(s.out.includes(SELF_MD.trim()), `C1 self show prints the document\n${s.out}`);
  });
  await check('C2 self show --json: null for a plain self.md, the contract\'s dashboard-data self block for a version 1 one (until kit-868)', () => {
    assert.equal(W.run(['self', 'show', '--json']).out, 'null', 'C2 null for a plain self.md');
    W.onMain({ [SELF]: V1, ...V1_PARTS }, 'version 1');
    const j = W.run(['self', 'show', '--json']);
    assert.deepEqual(j.status === 0 ? JSON.parse(j.out) : j.text, DATA.self, 'C2 self show --json is the contract\'s dashboard-data self block');
  });
  await check('C3 dashboard-data carries main\'s version 1 self.md as its self block, not the working tree\'s', () => {
    assert.deepEqual(json(W.ok(['dashboard-data'])).self, DATA.self, 'C3 dashboard-data carries main\'s self.md as its self block');
    write(path.join(W.old, SELF), v1What('Something else entirely.'));
    assert.deepEqual(json(W.ok(['dashboard-data'])).self, DATA.self, 'C3 dashboard-data reads main, not the working tree');
    W.g(['checkout', '--', SELF], W.old);
    W.onMain({ [SELF]: SELF_MD }, 'plain again');
  });
  await check('C4 search finds a word of self.md', () => {
    const hits = json(W.ok(['search', 'long notes', '--json'])).results.map((r) => r.id);
    assert.ok(hits.some((id) => /^self\.md(#|$)/.test(id)), `C4 search finds a word of self.md\n${JSON.stringify(hits)}`);
  });
  await check('C5 governance lists self.md between strategy.md and exterior.md, written, titled Self', () => {
    const gov = json(W.ok(['governance', '--json'])).files.filter((r) => r.group === 'project');
    assert.deepEqual(gov.map((r) => r.path), [STRAT, SELF, EXT], 'C5 governance lists self.md between strategy.md and exterior.md');
    const row = gov.find((r) => r.path === SELF);
    assert.deepEqual([row?.title, row?.written, row?.state], ['Self', true, null], 'C5 self.md on main is written, titled from its heading');
  });
}));

test('a project without self.md: show says not drafted yet, check and validate pass, data and governance say so (DW1, DW2)', withProject('self-none', { self: null }, async (W, check) => {
  await check('C8 self show says self.md is not drafted yet', () => {
    const s = W.run(['self', 'show']);
    assert.equal(s.status, 0, `C8 self show exits 0 with no self.md\n${s.text}`);
    assert.match(s.out, /self\.md is not drafted yet/, 'C8 self show says self.md is not drafted yet');
    assert.equal(W.run(['self', 'show', '--json']).out, 'null', 'C8 self show --json is null with no self.md');
  });
  await check('C8 self check and validate pass with no self.md', () => {
    const c = W.run(['self', 'check']);
    assert.equal(c.status, 0, `C8 self check passes with no self.md\n${c.text}`);
    assert.match(c.out, /self\.md is not drafted yet/, 'C8 self check says there is nothing to check');
    assert.doesNotMatch(W.run(['validate']).out, /self\.md/, 'C8 validate says nothing about a missing self.md');
  });
  await check('C3 dashboard-data self is null with no self.md', () => {
    assert.equal(json(W.ok(['dashboard-data'])).self, null, 'C3 dashboard-data self is null with no self.md');
  });
  await check('C5 governance lists self.md as not written yet', () => {
    const row = json(W.ok(['governance', '--json'])).files.find((r) => r.path === SELF);
    assert.deepEqual([row?.title, row?.written, row?.state], ['Self', false, 'not written yet'], 'C5 governance lists self.md as not written yet');
  });
}));

// whether a path is in the fixture repo's working tree by exact case ('' the root)
const hasIn = (root) => (p) => { let dir = root; for (const x of p === '' ? [] : p.split('/')) { let n; try { n = fs.readdirSync(dir); } catch { return false; } if (!n.includes(x)) return false; dir = path.join(dir, x); } return true; };
test('self check and validate refuse every self case in test/fixtures/world/invalid/ (DW2)', withProject('self-invalid', {}, async (W, check) => {
  await check('C6 self check refuses each version 1 case as a draft, saying why as self@2 does', () => {
    for (const c of CASES) {
      const text = world(`invalid/${c.file}`);
      write(path.join(W.old, SELF), text);
      const r = W.run(['self', 'check']);
      assert.notEqual(r.status, 0, `C6 self check refuses ${c.file}\n${r.text}`);
      for (const e of refCheckSelf(text, { root: P, has: hasIn(W.old) }).errors) assert.ok(r.out.includes(`error: self.md: ${e}`), `C6 self check says "${e}" for ${c.file}\n${r.out}`);
    }
    // a self.md saved with CRLF line ends is the same document
    write(path.join(W.old, SELF), SELF_MD.replace(/\n/g, '\r\n'));
    const crlf = W.run(['self', 'check']);
    assert.equal(crlf.status, 0, `C6 self check passes the fixture with CRLF line ends\n${crlf.text}`);
  });
  await check('C7 validate refuses each self case, saying why: self@1\'s words for a block, self@2\'s for none', () => {
    for (const c of CASES) {
      write(path.join(W.old, SELF), world(`invalid/${c.file}`));
      const v = W.run(['validate']);
      assert.notEqual(v.status, 0, `C7 validate refuses ${c.file}\n${v.text}`);
      const why = c.file === 'self-no-block.md' ? 'no part' : c.expect;
      assert.match(v.out, new RegExp(`error: ${re(SELF)}: .*${re(why)}`), `C7 validate says why for ${c.file}\n${v.out}`);
    }
  });
  await check('C6 self show prints main\'s broken version 1 self.md as it is; C3 dashboard-data self is then null', () => {
    W.onMain({ [SELF]: world('invalid/self-no-parts.md') });
    const s = W.run(['self', 'show']);
    assert.equal(s.status, 0, `C6 self show prints it\n${s.text}`);
    assert.ok(s.out.includes(world('invalid/self-no-parts.md').trim()), 'C6 self show prints the document');
    assert.equal(json(W.ok(['dashboard-data'])).self, null, 'C3 dashboard-data self is null when main\'s self.md breaks the contract');
  });
}));

test('a part\'s path is checked at the draft only: self check, chore pr, check-pr and merge --chore (DW3)', withProject('self-paths', { visibility: 'private' }, async (W, check) => {
  await check('C9 self check refuses a part whose path is gone from the working tree', () => {
    fs.rmSync(path.join(W.old, 'docs/devteam/services'), { recursive: true, force: true });
    const c = W.run(['self', 'check']);
    W.g(['checkout', '--', 'docs/devteam/services'], W.old);
    assert.notEqual(c.status, 0, `C9 self check refuses a part whose path is gone\n${c.text}`);
    assert.match(c.out, /error: self\.md: part link \.\.\/services\/sync\/ points to nothing/, 'C9 self check names the part link');
    const ok = W.run(['self', 'check']);
    assert.equal(ok.status, 0, `C9 self check passes while every part's path is there\n${ok.text}`);
  });
  await check('C32 a part link is resolved alike on disk and in git: "./../app/", "../services//sync/" and "../../" exist', () => {
    const dots = withProse('Its parts also read as [the app](./../app/), [the sync service](../services//sync/) and [the whole repo](../../).');
    write(path.join(W.old, SELF), dots);
    const c = W.run(['self', 'check']);
    assert.equal(c.status, 0, `C32 self check passes links that exist, spelled with . and //\n${c.text}`);
    const q = W.chorePr('dots', (w) => write(path.join(w, SELF), dots));
    assert.equal(q.status, 0, `C32 chore pr pushes them\n${q.text}`);
    W.g(['checkout', '--', SELF], W.old);
    write(path.join(W.old, SELF), withProse('Its app is also [the App](../App/).'));
    const k = W.run(['self', 'check']);
    W.g(['checkout', '--', SELF], W.old);
    assert.match(k.out, /error: self\.md: part link \.\.\/App\/ points to nothing/, `C32 a path is matched with its case, as git reads it, on any disk\n${k.out}`);
  });
  let p = null;
  await check('C10 chore pr refuses a self.md whose part\'s path is gone at its head, even on a private repo, and pushes nothing', () => {
    p = W.chorePr('gone', (w) => { W.rmPath(w, 'docs/devteam/services'); write(path.join(w, SELF), withProse('It also keeps a log.')); });
    assert.notEqual(p.status, 0, `C10 chore pr refuses a self.md whose part's path is gone\n${p.text}`);
    assert.match(p.text, /self\.md: part link \.\.\/services\/sync\/ points to nothing/, 'C10 chore pr names the part link');
    assert.equal(p.pushed(), false, 'C10 chore pr pushes nothing');
  });
  // the branch as pushed by hand: check-pr and merge --chore refuse it too
  const sha = (() => { const w = path.join(W.old, '.worktrees', 'chore-gone'); W.g(['add', '-A'], w); W.g(['commit', '-qm', 'by hand', '--allow-empty'], w); W.g(['push', '-qf', 'origin', 'chore-gone'], w); write(path.join(W.old, 'docs/devteam/run/pr/chore-gone.md'), '# chore-gone: x\n\n## One-way doors\n\nNone.\n'); return W.g(['rev-parse', 'HEAD'], w); })();
  await check('C11 check-pr refuses a PR changing self.md whose part\'s path is gone at the head', () => {
    const k = W.checkPr('chore-gone', sha);
    assert.notEqual(k.status, 0, `C11 check-pr refuses it\n${k.text}`);
    assert.match(k.text, /self\.md breaks self@2 at [0-9a-f]{12}: part link \.\.\/services\/sync\/ points to nothing/, 'C11 check-pr names it');
  });
  await check('C11 merge --chore names it too', () => {
    const m = W.run(['merge', '--chore', 'gone', '--dry-run']);
    assert.match(m.text, /self\.md breaks self@2 at [0-9a-f]{12}: part link \.\.\/services\/sync\/ points to nothing/, `C11 merge --chore names it\n${m.text}`);
  });
}));

test('on main a part\'s path gone fails nothing: the refactor passes check-pr and metrics raises self-drift once per path (DW3)', withProject('self-drift', { visibility: 'private' }, async (W, check) => {
  await check('C12 a refactor deleting parts\' paths passes check-pr and validate, and metrics raises self-drift once per path', () => {
    assert.deepEqual(W.findings('self-drift'), [], 'C12 no self-drift while every part\'s path is on main');
    const sha = W.branchOf('chore-refactor', (w) => { W.rmPath(w, 'docs/devteam/services'); W.rmPath(w, 'docs/devteam/plugin api'); write(path.join(w, 'docs/devteam/web/sync.js'), 'moved\n'); });
    const k = W.checkPr('chore-refactor', sha);
    assert.equal(k.status, 0, `C12 a refactor deleting a part's path, self.md untouched, passes check-pr\n${k.text}`);
    W.onMain({ 'docs/devteam/services': null, 'docs/devteam/plugin api': null, 'docs/devteam/web/sync.js': 'moved\n' }, 'refactor');
    assert.doesNotMatch(W.run(['validate']).out, /self\.md/, 'C12 validate says nothing of a part\'s path on main');
    const f = W.findings('self-drift');
    assert.deepEqual(f.map((x) => [x.severity, x.subject, x.key]).sort(), [['low', 'self', 'docs/devteam/plugin api/index.js'], ['low', 'self', 'docs/devteam/services/sync']], `C12 self-drift, low, subject self, once per missing path, keyed by it\n${JSON.stringify(f)}`);
    assert.match(f[0].detail, /part link \.\.\/(services\/sync\/|plugin%20api\/index\.js#top) points to nothing on main/, 'C12 the detail names the path');
  });
  await check('C28 observe-metrics records each self-drift path as its own observation, its source_key carrying the finding\'s key', () => {
    W.ok(['observe-metrics']);
    const keys = logLines(W).filter((o) => o.type === 'observation' && o.kind === 'self-drift').map((o) => o.source_key).sort();
    assert.deepEqual(keys, ['metrics:self-drift:self:docs/devteam/plugin api/index.js', 'metrics:self-drift:self:docs/devteam/services/sync'], `C28 one observation per path\n${JSON.stringify(keys)}`);
  });
}));

test('the names rule: self check warns on a capitalised word main\'s strategy and dependency files lack (DW4)', withProject('self-names', {}, async (W, check) => {
  W.onMain({ 'package.json': '{ "dependencies": { "ferrous": "1.0.0" } }\n', Gemfile: 'gem "inkpad"\n', 'requirements.txt': 'quillsync==1.2\n' });
  await check('C13 the fixture self.md, naming only what the strategy names, draws no names warning', () => {
    const c = W.run(['self', 'check']);
    assert.equal(c.status, 0, `C13 self check passes the fixture\n${c.text}`);
    assert.doesNotMatch(c.out, /warning: self\.md: "/, 'C13 no names warning');
  });
  await check('C13 self check warns once per word main\'s strategy.md and dependency files lack, not a sentence\'s first word; code, links and comments count; the whole text is read', () => {
    // Postwick is in the working tree's strategy but not main's
    write(path.join(W.old, STRAT), `${STRATEGY}\nMail goes through Postwick.\n`);
    write(path.join(W.old, SELF), withProse('Brightline hosts it. It mails through Postwick, Inkpad and Quillsync, and `Zephyr` runs it.\n\nThe notes sync through\nBrightline today. Its [Vellum plugins](../app/) keep notes through Postwick and Ferrous, and it does not control Stripe.'));
    const c = W.run(['self', 'check']);
    assert.equal(c.status, 0, `C13 a names warning leaves self check's exit at 0\n${c.text}`);
    const warned = [...c.out.matchAll(/warning: self\.md: "([^"]+)" \(([^)]+)\)/g)].map((m) => `${m[1]} ${m[2]}`);
    assert.deepEqual(warned, ['Postwick prose', 'Zephyr prose', 'Brightline prose', 'Vellum prose', 'Stripe prose'], `C13 the words warned, each at its first place (code is public too)\n${c.out}`);
  });
  await check('C18 one function, unknownNames, in the self-model region, says which words', () => {
    assert.equal((SRC.match(/\nfunction unknownNames\(/g) ?? []).length, 1, 'C18 unknownNames is defined once');
    assert.match(SRC, /\/\* self-model start \*\/[\s\S]*\nfunction unknownNames\([\s\S]*\/\* self-model end \*\//, 'C18 inside the self-model region');
  });
}));

test('the names hold: chore pr refuses a self.md draft on a public or unknown repo until --names-checked names each word (DW4)', withProject('self-hold', { visibility: 'public' }, async (W, check) => {
  const draft = (w) => write(path.join(w, SELF), withProse('It mails through Postwick, and it does not control Stripe.'));
  await check('C14 on a public repo chore pr refuses while a warning stands, listing each word, and pushes nothing', () => {
    const p = W.chorePr('a', draft);
    assert.notEqual(p.status, 0, `C14 chore pr refuses on a public repo while a warning stands\n${p.text}`);
    assert.match(p.text, /this repo is public/, 'C14 says the repo is public');
    assert.match(p.text, /"Postwick" \(prose\)/, 'C14 lists Postwick');
    assert.match(p.text, /"Stripe" \(prose\)/, 'C14 lists Stripe');
    assert.equal(p.pushed(), false, 'C14 chore pr pushes nothing');
  });
  await check('C34 a refused chore pr undoes its own commit, so rewording the draft clears it and the word is never pushed', () => {
    const r = W.chorePr('e', draft);
    assert.notEqual(r.status, 0, 'C34 refused first');
    const again = W.chorePr('e', (w) => write(path.join(w, SELF), withProse('It also keeps a log.')));
    assert.equal(again.status, 0, `C34 the reworded draft pushes\n${again.text}`);
    assert.doesNotMatch(W.g(['log', '-p', 'origin/main..origin/chore-e', '--', SELF], W.old), /Postwick|Stripe/, 'C34 no pushed commit carries the refused words');
  });
  await check('C29 the visibility chore pr read is recorded under run/ for metrics', () => {
    const f = path.join(W.old, 'docs/devteam/run/repo-visibility.json');
    assert.ok(fs.existsSync(f), 'C29 chore pr records the visibility it read in run/repo-visibility.json');
    const rec = JSON.parse(fs.readFileSync(f, 'utf8'));
    assert.equal(rec.visibility, 'public', 'C29 run/repo-visibility.json holds the last answer');
    assert.ok(!Number.isNaN(Date.parse(rec.at)), 'C29 with when it was read');
  });
  await check('C15 --names-checked naming only some words is refused, naming the rest', () => {
    const part = W.chorePr('a', () => {}, ['--names-checked', 'Stripe']);
    assert.notEqual(part.status, 0, `C15 --names-checked naming only some words is refused\n${part.text}`);
    assert.match(part.text, /"Postwick" \(prose\)/, 'C15 it lists the word left unnamed');
    assert.doesNotMatch(part.text, /"Stripe" \(prose/, 'C15 and not the one named');
    assert.equal(part.pushed(), false, 'C15 nothing pushed');
  });
  await check('C15 --names-checked naming every word pushes, and logs a names-checked act on the chore', () => {
    const all = W.chorePr('a', () => {}, ['--names-checked', 'Stripe,Postwick']);
    assert.equal(all.status, 0, `C15 --names-checked naming every word pushes\n${all.text}`);
    assert.equal(all.pushed(), true, 'C15 pushed');
    const acts = logLines(W).filter((o) => o.type === 'act' && o.class === 'names-checked');
    assert.deepEqual(acts.map((a) => [a.scope, [...a.refs].sort()]), [['self', ['chore-a', 'name:Postwick', 'name:Stripe']]], `C15 the words are logged on the chore\n${JSON.stringify(acts)}`);
  });
  await check('C14 unknown visibility holds the same', () => {
    W.setVisibility('unknown');
    const u = W.chorePr('b', draft);
    assert.notEqual(u.status, 0, `C14 chore pr refuses when the repo's visibility is unknown\n${u.text}`);
    assert.match(u.text, /visibility is unknown/, 'C14 and says why');
    assert.match(u.text, /"Postwick" \(prose\)/, 'C14 listing the word');
    assert.equal(u.pushed(), false, 'C14 nothing pushed');
  });
  await check('C31 a word in an earlier commit of the chore holds it, though the head rewords it out: chore pr and check-pr read every self.md blob since the merge base', () => {
    W.setVisibility('public');
    const w = path.join(W.old, '.worktrees', 'chore-d');
    W.ok(['chore', 'start', 'd']);
    draft(w);
    W.g(['add', '-A'], w);
    W.g(['commit', '-qm', 'first draft, naming them'], w);
    const p = W.chorePr('d', () => write(path.join(w, SELF), withProse('It also keeps a log.')));
    assert.notEqual(p.status, 0, `C31 chore pr refuses: the first commit's self.md names Postwick and Stripe\n${p.text}`);
    assert.match(p.text, /"Postwick" \(prose\)/, 'C31 chore pr lists the word from the earlier commit');
    assert.match(p.text, /that commit is not pushed yet: drop it from the branch/, 'C31 chore pr says the earlier commit is not pushed yet');
    assert.equal(p.pushed(), false, 'C31 nothing pushed');
    W.g(['push', '-q', 'origin', 'chore-d'], w);
    write(path.join(W.old, 'docs/devteam/run/pr/chore-d.md'), '# chore-d: x\n\n## One-way doors\n\nNone.\n');
    const k = W.checkPr('chore-d', W.g(['rev-parse', 'HEAD'], w));
    assert.notEqual(k.status, 0, `C31 check-pr refuses it too\n${k.text}`);
    assert.match(k.text, /names "Postwick" \(prose\)/, 'C31 check-pr lists the word from the earlier commit');
    assert.equal((SRC.match(/\nfunction draftBlobs\(/g) ?? []).length, 1, 'C31 draftBlobs is defined once');
    assert.match(SRC, /\/\* self-model start \*\/[\s\S]*\nfunction draftBlobs\([\s\S]*\/\* self-model end \*\//, 'C31 inside the self-model region');
  });
  await check('C16 on a private repo chore pr pushes, printing each warning', () => {
    W.setVisibility('private');
    const q = W.chorePr('c', draft);
    assert.equal(q.status, 0, `C16 chore pr pushes on a private repo\n${q.text}`);
    assert.match(q.text, /"Postwick" \(prose\)/, 'C16 and still prints each warning');
    assert.equal(q.pushed(), true, 'C16 pushed');
  });
  await check('C34 a refusal undoes only a commit chore pr made: a draft committed by hand stays the head', () => {
    W.setVisibility('public');
    const w = path.join(W.old, '.worktrees', 'chore-f');
    W.ok(['chore', 'start', 'f']);
    draft(w);
    W.g(['add', '-A'], w);
    W.g(['commit', '-qm', 'the draft, by hand'], w);
    const hand = W.g(['rev-parse', 'HEAD'], w);
    const p = W.chorePr('f', () => {});
    assert.notEqual(p.status, 0, `C34 chore pr refuses the hand-committed draft\n${p.text}`);
    assert.equal(p.sha(), hand, 'C34 the hand commit is still the head');
    assert.equal(p.pushed(), false, 'C34 nothing pushed');
  });
  await check('C14 a gh that hangs past DEVTEAM_GH_TIMEOUT_MS reads as unknown, and chore pr refuses within 10 s', () => {
    W.setSlow(true);
    const at = Date.now();
    const p = W.chorePr('g', draft, [], { ...W.ENV, DEVTEAM_GH_TIMEOUT_MS: '500' });
    const took = Date.now() - at;
    W.setSlow(false);
    assert.notEqual(p.status, 0, `C14 chore pr refuses when gh hangs\n${p.text}`);
    assert.match(p.text, /visibility is unknown/, 'C14 a hung gh reads as unknown');
    assert.ok(took < 10000, `C14 chore pr refused within 10 s (took ${took} ms)`);
    assert.equal(p.pushed(), false, 'C14 nothing pushed');
  });
}));

test('the names hold reads only the self.md blobs a chore introduces: main\'s, merged in, are not the chore\'s (DW4)', withProject('self-merges', { self: null, visibility: 'public' }, async (W, check) => {
  const w = path.join(W.old, '.worktrees', 'chore-m');
  W.ok(['chore', 'start', 'm']);
  write(path.join(w, `${P}/designs/n.md`), 'n\n');
  W.g(['add', '-A'], w);
  W.g(['commit', '-qm', 'a note'], w);
  // main gains a self.md naming Vellum (no word of the strategy), the chore merges it, main changes it, the chore merges again
  const vellum = SELF_MD.replace('It controls its code', 'It renders through Vellum.\n\nIt controls its code');
  const merges = [];
  for (const text of [vellum, vellum.replace('It renders through Vellum.', 'It renders through Vellum, page by page.')]) {
    W.onMain({ [SELF]: text }, 'self.md');
    W.g(['fetch', '-q', 'origin', 'main'], w);
    W.g(['merge', '-q', '--no-edit', 'origin/main'], w);
    merges.push(W.g(['rev-parse', 'HEAD'], w));
  }
  await check('C31 a chore that only merges main\'s self.md changes no self.md: chore pr pushes on a public repo', () => {
    const p = W.chorePr('m', () => {});
    assert.equal(p.status, 0, `C31 draftBlobs is empty for main's blobs merged in\n${p.text}`);
    assert.equal(p.pushed(), true, 'C31 pushed');
  });
  await check('C31 once the chore edits self.md, the hold lists the head\'s word and names neither merge commit', () => {
    const p = W.chorePr('m', (wt) => write(path.join(wt, SELF), fs.readFileSync(path.join(wt, SELF), 'utf8').replace('It controls its code', 'It keeps a log.\n\nIt controls its code')));
    assert.notEqual(p.status, 0, `C31 chore pr refuses the edited draft\n${p.text}`);
    assert.match(p.text, /"Vellum" \(prose\)/, 'C31 it lists Vellum at the head');
    assert.doesNotMatch(p.text, /"Vellum" \(prose\) in /, 'C31 as the head\'s word, not an earlier commit\'s');
    for (const m of merges) assert.doesNotMatch(p.text, new RegExp(m.slice(0, 12)), `C31 no line names the merge commit ${m.slice(0, 12)}`);
  });
}));

test('check-pr holds any PR changing self.md on a public repo, chore, plan or ticket, and warns on unknown (DW4)', withProject('self-checkpr', { visibility: 'private' }, async (W, check) => {
  const draft = (w) => write(path.join(w, SELF), SELF_MD.replace('It controls its code', 'It mails through Postwick.\n\nIt controls its code'));
  const plain = W.chorePr('plain', (w) => write(path.join(w, `${P}/designs/n.md`), 'n\n'));
  const baseline = W.checkPr('chore-plain', plain.sha()).status;
  assert.equal(baseline, 0, 'check-pr passes a chore changing only a note');
  const unnamed = W.chorePr('unnamed', draft);
  const named = W.chorePr('named', draft, ['--names-checked', 'Postwick']);
  const G = W.goal('Billing', 1);
  W.feature('billing', G);
  W.ticket('billing-01-a', 'billing');
  const planSha = W.branchOf('plan/billing', draft);
  const ticketSha = W.branchOf('ticket/billing-01-a', draft);
  W.setVisibility('public');
  await check('C17 on a public repo check-pr refuses a chore whose words its --names-checked did not name', () => {
    const u = W.checkPr('chore-unnamed', unnamed.sha());
    assert.notEqual(u.status, 0, `C17 check-pr refuses it\n${u.text}`);
    assert.match(u.text, /^fail: .*names "Postwick" \(prose\)/m, 'C17 check-pr fails on the word, not only warns');
  });
  await check('C17 a chore that logged --names-checked for each word passes', () => {
    const n = W.checkPr('chore-named', named.sha());
    assert.equal(n.status, baseline, `C17 it passes\n${n.text}`);
  });
  await check('C17 a plan or ticket PR changing self.md on a public repo is refused, and clears only by rewording', () => {
    for (const [ref, sha] of [['plan/billing', planSha], ['ticket/billing-01-a', ticketSha]]) {
      const r = W.checkPr(ref, sha);
      assert.match(r.text, /^fail: .*names "Postwick" \(prose\)[^\n]*reword/m, `C17 ${ref} fails on the word, and clears only by rewording\n${r.text}`);
    }
  });
  await check('C17 a names-checked act naming a plan clears nothing: only a chore\'s acts count', () => {
    W.ok(['act', '--class', 'names-checked', '--scope', 'self', '--refs', 'plan-billing', 'name:Postwick', '--', 'checked the names Postwick by hand']);
    const r = W.checkPr('plan/billing', planSha);
    assert.match(r.text, /^fail: .*names "Postwick" \(prose\)/m, `C17 the plan PR still fails on the word\n${r.text}`);
  });
  await check('C33 merge --chore holds the same: it lists the unchecked word on a public repo', () => {
    const m = W.run(['merge', '--chore', 'unnamed', '--dry-run']);
    assert.match(m.text, /^(?!warn).*names "Postwick" \(prose\)/m, `C33 merge --chore refuses on it (a line that is no warning)\n${m.text}`);
  });
  await check('C17 on unknown visibility check-pr warns, its exit unchanged', () => {
    W.setVisibility('unknown');
    const w = W.checkPr('chore-unnamed', unnamed.sha());
    assert.match(w.text, /^warn: .*names "Postwick" \(prose\)/m, `C17 check-pr warns\n${w.text}`);
    assert.doesNotMatch(w.text, /^fail: .*names "Postwick"/m, 'C17 and does not fail on it');
    assert.equal(w.status, baseline, 'C17 and its exit is unchanged');
  });
}));

test('linksSelf: metrics raises self-unlinked and self-missing, and self check warns on an unlinked strategy (DW5, DW6)', async (t) => {
  const unlinked = STRATEGY.replace(/^What Quillmark is.*\n\n/m, '');
  const W = proj('self-links', { strategy: unlinked });
  const check = (title, fn) => t.test(title, fn);
  const one = (kind) => { const f = W.findings(kind); assert.ok(f.length <= 1, `${kind} once\n${JSON.stringify(f)}`); return f[0] ?? null; };
  try {
    await check('C19 self-unlinked: low, subject self, keyed by the strategy\'s blob, when main has self.md and a strategy not linking it', () => {
      const f = one('self-unlinked');
      assert.deepEqual([f?.severity, f?.subject, f?.key], ['low', 'self', W.blob(STRAT)], 'C19 self-unlinked raised');
    });
    await check('C24 self check warns when main has self.md and its strategy does not link it', () => {
      assert.match(W.run(['self', 'check']).out, /warning: main's strategy\.md does not link self\.md/, 'C24 self check warns');
    });
    await check('C19 what links self.md: an inline or reference link to self.md or ./self.md, outside a fenced block', () => {
      for (const [how, text, links] of [
        ['an inline link to self.md', `See [what it is](self.md).\n\n${unlinked}`, true],
        ['an inline link to ./self.md with a title', `See [what it is](./self.md "the Self").\n\n${unlinked}`, true],
        ['a reference link to ./self.md', `See [what it is][s].\n\n[s]: ./self.md\n\n${unlinked}`, true],
        ['a link to another self.md', `See [it](designs/self.md).\n\n${unlinked}`, false],
        ['a link inside a fenced block', `\`\`\`\n[it](./self.md)\n\`\`\`\n\n${unlinked}`, false],
      ]) {
        W.onMain({ [STRAT]: text }, how);
        assert.equal(one('self-unlinked') === null, links, `C19 ${how} ${links ? 'links' : 'does not link'} self.md`);
      }
    });
    await check('C19 no self-unlinked once main has no self.md; C20 self-missing then, its next step the link first', () => {
      W.onMain({ [STRAT]: unlinked, [SELF]: null }, 'no self.md');
      assert.equal(one('self-unlinked'), null, 'C19 no self-unlinked without self.md');
      const f = one('self-missing');
      assert.deepEqual([f?.severity, f?.subject, f?.key], ['high', 'self', W.blob(STRAT)], 'C20 self-missing: high (kit-814 K1), subject self, keyed by the strategy\'s blob');
      assert.match(f?.suggestion ?? '', /first[^;]*strategy-change[^;]*self\.md[\s\S]*then draft self\.md/i, `C20 unlinked: the link first, then the draft\n${f?.suggestion}`);
    });
    await check('C20 linked: self-missing\'s next step is the draft alone; none once main has self.md', () => {
      W.onMain({ [STRAT]: STRATEGY }, 'linked');
      const f = one('self-missing');
      assert.ok(f && !/strategy-change/.test(f.suggestion) && /draft self\.md/.test(f.suggestion), `C20 the draft alone\n${f?.suggestion}`);
      W.onMain({ [SELF]: SELF_MD }, 'drafted');
      assert.equal(one('self-missing'), null, 'C20 none once main has self.md');
    });
    await check('C21 one function, linksSelf, in the self-model region, decides the link', () => {
      assert.equal((SRC.match(/\nfunction linksSelf\(/g) ?? []).length, 1, 'C21 linksSelf is defined once');
      assert.match(SRC, /\/\* self-model start \*\/[\s\S]*\nfunction linksSelf\([\s\S]*\/\* self-model end \*\//, 'C21 inside the self-model region');
    });
  } finally { W.done(); }
});

// kit-814: self-missing is high, so wait brings it back, until the owner has been asked about the
// next step it names (the strategy-change link first, then self.md); medium while that question is open.
test('self-missing is high until the owner is asked about its next step, medium while that question is open (kit-814)', async (t) => {
  const unlinked = STRATEGY.replace(/^What Quillmark is.*\n\n/m, '');
  const W = proj('self-asked', { strategy: unlinked, self: null });
  const check = (title, fn) => t.test(title, fn);
  const severity = () => W.findings('self-missing').map((f) => f.severity);
  let n = 0;
  const ask = (cls, rel, title, slug) => W.ok(['ask', '--question', `Approve this draft of ${title} (${++n})?`, '--recommendation', 'yes', '--stake', '3', '--urgency', '2',
    '--class', cls, '--reasons', 'owner-only', '--links', JSON.stringify([{ title, path: rel, ref: `chore-${slug}` }]), ...(cls === 'strategy-change' ? [] : ['--approves', `chore-${slug}`])]).trim();
  try {
    await check('K4 unlinked: an open self-change question is not the next step, so self-missing stays high', () => {
      assert.equal(W.chorePr('self', (w) => write(path.join(w, SELF), SELF_MD)).status, 0, 'K4 the self.md draft is on its chore');
      ask('self-change', SELF, 'The Self', 'self');
      assert.deepEqual(severity(), ['high'], 'K4 high: the strategy-change link comes first');
    });
    await check('K4 unlinked: medium while a strategy-change question about the link is open', () => {
      assert.equal(W.chorePr('link', (w) => write(path.join(w, STRAT), STRATEGY)).status, 0, 'K4 the linking strategy is on its chore');
      ask('strategy-change', STRAT, 'The strategy', 'link');
      assert.deepEqual(severity(), ['medium'], 'K4 medium while the owner reads the link');
    });
    await check('K5 linked: medium while the self-change question is open', () => {
      W.onMain({ [STRAT]: STRATEGY }, 'the link lands');
      assert.deepEqual(severity(), ['medium'], 'K5 medium: the self-change question is the next step, and it is open');
    });
    await check('K6 no strategy on main: no self-missing and no exterior-missing, even with self.md', () => {
      W.onMain({ [STRAT]: null }, 'no strategy');
      assert.deepEqual(W.findings('self-missing'), [], 'K6 no self-missing without a strategy');
      W.onMain({ [SELF]: SELF_MD }, 'self.md, still no strategy');
      assert.deepEqual(W.findings('exterior-missing'), [], 'K6 no exterior-missing without a strategy');
    });
  } finally { W.done(); }
});

test('init\'s strategy template links self.md in its opening lines; on the template no self finding fires (DW5, DW6)', withProject('self-template', { strategy: null, self: null }, async (W, check) => {
  const t = fs.readFileSync(path.join(W.old, STRAT), 'utf8');
  await check('C22 the template links self.md in its opening lines and asks for no description of the project', () => {
    const opening = t.split('\n').slice(0, 8).join('\n');
    assert.match(opening, /what it makes and its parts are in \[self\.md\]\(\.\/self\.md\); this page says why it exists/i, `C22 the opening says what is in self.md and what stays here\n${opening}`);
    assert.doesNotMatch(t, /<[^>]*(what (the|this) project is|describe the project)[^>]*>/i, 'C22 the template asks for no description of the project');
  });
  await check('C20 no self-missing while the strategy is init\'s template', () => {
    assert.deepEqual(W.findings('self-missing'), [], 'C20 none on the template');
  });
  await check('C22 the template\'s link counts: no self-unlinked with self.md on main', () => {
    W.onMain({ [SELF]: SELF_MD }, 'drafted on the template');
    const f = W.findings('self-unlinked');
    const m = json(W.ok(['metrics', '--json'])).findings.map((x) => x.kind);
    assert.ok(f.length === 0 && /self/.test(SRC.match(/const STRATEGY_MD = `[\s\S]*?`;/)?.[0] ?? '') && m.every((k) => k !== 'self-unlinked') && /\[self\.md\]\(\.\/self\.md\)/.test(t), 'C22 no self-unlinked on the linked template');
  });
  await check('K7 on the template, self.md on main and no exterior.md raise no exterior-missing (kit-814)', () => {
    assert.deepEqual(W.findings('exterior-missing'), [], 'K7 none while the strategy is the template, though it links self.md');
  });
  await check('C23 the comment directly above const STRATEGY_MD says the kit now reads it for the link to self.md', () => {
    const comment = /\nconst STRATEGY_TEMPLATE_MARK[^\n]*\n((?:\/\/[^\n]*\n)*)const STRATEGY_MD = /.exec(SRC)?.[1] ?? '';
    assert.match(comment, /reads it[^.]*link to self\.md|link to self\.md[^.]*reads it/i, `C23 the comment says so\n${comment}`);
  });
}));

test('help and supervisor.md say it (DW1, DW4, DW7)', async (t) => {
  await t.test('C27 HELP_OBSERVE lists self show and self check; HELP_GOALS lists chore pr --names-checked', () => {
    assert.match(SRC, /\n {2}self show \[--json\][^\n]*\n {2}self check/, 'C27 HELP_OBSERVE lists self show and self check');
    assert.match(SRC, /chore pr <slug> --title t[^\n]*--names-checked/, 'C27 HELP_GOALS lists chore pr --names-checked');
  });
  const sup = fs.readFileSync(path.join(KIT, 'process', 'supervisor.md'), 'utf8');
  const mon = /\n### Monitoring\n([\s\S]*?)\n## /.exec(sup)?.[1] ?? '';
  for (const [what, pattern] of [
    ['the order: a strategy-change linking self.md, then self.md, then exterior.md', /strategy-change linking `?self\.md`?[^.]*(lacks|doesn't link|restates)[\s\S]{0,300}then `?self\.md`?[\s\S]{0,200}then `?exterior\.md`?/],
    ['from the code and the strategy', /from the code and the strategy/],
    ['what it is', /what (the project|it) is/],
    ['what it makes or does', /what it makes or does/],
    ['what it controls', /what it controls/],
    ['its parts with their paths', /parts with (their|the) paths/],
    ['what it controls and what it touches but does not', /touches but does(n't| not)/],
    ['never a private person', /never a private person/],
    ['ask self-change', /self-change/],
    ['run self check before chore pr', /`self check`[^.]*before `chore pr`/],
    ['--names-checked', /--names-checked/],
    ['self-drift, self-unlinked and self-missing', /self-drift[\s\S]*self-unlinked[\s\S]*self-missing|self-missing[\s\S]*self-unlinked[\s\S]*self-drift/],
  ]) await t.test(`C26 supervisor.md Monitoring documents ${what}`, () => assert.match(mon, pattern, `C26 ${what}`));
  // kit-814
  const start = /\n## 1\. Starting up\n([\s\S]*?)\n## /.exec(sup)?.[1] ?? '';
  const asking = /\n## 6\. Questions to the owner\n([\s\S]*?)\n## /.exec(sup)?.[1] ?? '';
  await t.test('K8 Starting up says to draft the Self and then the Exterior after the strategy, high until the owner has the draft', () => {
    const step = start.split('\n').find((l) => /strategy-unwritten/.test(l)) ?? '';
    assert.match(step, /^3\. No strategy, Self or Exterior yet \(`strategy-unwritten`[^)]*`self-missing`[^)]*`exterior-missing`\)[\s\S]*Then the Self, then the Exterior, the same way[\s\S]*`self-missing` and `exterior-missing` are high until the owner has your draft[^.]*`wait` keeps bringing them back[^.]*medium while its question is open[^.]*high again[^.]*\. After their yes, land it \(`merge --chore/, `K8 step 3 opens on all three, and goes on from the strategy to the Self and the Exterior: high until the owner has the draft, so wait brings them back; medium while asked; high again\n${step}`);
  });
  await t.test('K9 Monitoring\'s self-missing line agrees: high until the owner has the draft, medium while asked', () => {
    assert.match(mon, /`self-missing` \([^)]*high until the owner has[^)]*medium while its question is open\)/, 'K9 the self-missing line says its severity');
  });
  await t.test('K10 §6: before a goal-met question recommends Yes, open each thing it names and say what you saw', () => {
    assert.match(asking, /`--class goal-met`[^\n]*Before it recommends Yes, open each thing the question names[^.]*on main or in the running product[^.]*say in `--context` what you saw/, 'K10 the goal-met row says to look first');
  });
});
