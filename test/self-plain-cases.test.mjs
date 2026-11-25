// kit-862: every world2 self case (and the two outside cases one folder further out) through the
// kit's draft checks: self check, check-pr and chore pr, each giving the reference checker's errors.
// Its own file, apart from test/self-plain.test.mjs, so neither nears CI's 300 s per file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { json, kit as KIT, write } from './lib/kit.mjs';
import { fixture, SUP } from './lib/next-step-fixture.mjs';
import { checkSelf as refCheckSelf, version as refVersion } from './fixtures/world2/check.mjs';

const P = 'docs/devteam/project';
const SELF = `${P}/self.md`;
const STRAT = `${P}/strategy.md`;
const world = (f) => fs.readFileSync(new URL(`./fixtures/world/${f}`, import.meta.url), 'utf8');
const world2 = (f) => fs.readFileSync(new URL(`./fixtures/world2/${f}`, import.meta.url), 'utf8');
const V1 = world('self.md');
const V1_PARTS = { 'app/main.js': 'app\n', 'app/plugins/api.js': 'api\n', 'sync/server.js': 'sync\n', 'deploy/sync.yml': 'deploy\n' };
const W2 = JSON.parse(world2('cases.json'));
const CASES = W2.cases.filter((c) => c.doc === 'self');
// What the surfaces read: each case, and the two outside cases one folder further out, since the
// fixture's project is one folder deeper than cases.json's root (so they leave its repo too).
const SURFACE = [...CASES.map((c) => ({ name: c.file, text: world2(c.file) })),
  ...['cases/self-part-outside.md', 'cases/self-part-outside-escaped.md'].map((f) => ({ name: `${f}, one folder further out`, text: world2(f).replace('/shop/)', '/../shop/)') }))];
// cases.json's root is docs/project; the fixture's project is docs/devteam/project, so its docs/x is docs/devteam/x
const PARTS = Object.fromEntries(W2.paths.map((p) => [`docs/devteam/${p.slice('docs/'.length)}`, 'x\n']));
const SELF_MD = world2('self.md');
const STRATEGY = world2('strategy.md');
const SRC = fs.readFileSync(path.join(KIT, 'scripts', 'devteam.mjs'), 'utf8');
const re = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

function proj(name, { strategy = STRATEGY, self = SELF_MD, files = PARTS, visibility = 'private' } = {}) {
  const F = fixture(name);
  const { old, g } = F;
  const bin = path.join(F.base, 'bin');
  const visFile = path.join(F.base, 'visibility');
  g(['config', `url.${F.org}.insteadOf`, 'https://github.com/acme/quillmark.git'], old);
  g(['remote', 'set-url', 'origin', 'https://github.com/acme/quillmark.git'], old);
  write(path.join(bin, 'gh'), `#!/bin/sh\ncase "$*" in *acme/quillmark*) ;; *) exit 1 ;; esac\nif [ "$1 $2" = "repo view" ] && [ -s '${visFile}' ]; then cat '${visFile}'; exit 0; fi\nexit 1\n`);
  fs.chmodSync(path.join(bin, 'gh'), 0o755);
  const setVisibility = (v) => fs.writeFileSync(visFile, v === 'unknown' ? '' : `${v.toUpperCase()}\n`);
  setVisibility(visibility);
  const ENV = { ...SUP, PATH: `${bin}${path.delimiter}${process.env.PATH}` };
  const run = (args, env = ENV, cwd = old) => { const r = F.run(cwd, args, env); return { status: r.status, out: r.out, err: r.err, text: `${r.out}\n${r.err}` }; };
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
  const chorePr = (slug, change, more = []) => {
    const w = path.join(old, '.worktrees', `chore-${slug}`);
    if (!fs.existsSync(w)) ok(['chore', 'start', slug]);
    change(w);
    const r = run(['chore', 'pr', slug, '--title', `${slug} draft`, ...more]);
    return { ...r, w, sha: () => g(['rev-parse', 'HEAD'], w), pushed: () => g(['ls-remote', 'origin', `refs/heads/chore-${slug}`], old) !== '' };
  };
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
  // whether a path is in the fixture repo's working tree by exact case, as git reads it ('' the root)
  const has = (p) => { let dir = old; for (const s of p === '' ? [] : p.split('/')) { let n; try { n = fs.readdirSync(dir); } catch { return false; } if (!n.includes(s)) return false; dir = path.join(dir, s); } return true; };
  return { ...F, run, ok, onMain, chorePr, branchOf, checkPr, findings, setVisibility, has, ENV };
}
const withProject = (name, opts, body) => async (t) => {
  const W = proj(name, opts);
  try { await body(W, (title, fn) => t.test(title, fn)); } finally { W.done(); }
};
const logLines = (W) => { const d = path.join(W.old, 'docs/devteam/run/log'); return fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.endsWith('.jsonl')).flatMap((f) => fs.readFileSync(path.join(d, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))) : []; };
// the self.md lines a command printed: its errors, without the "error: self.md: " or the file's path
const selfErrors = (text) => [...text.matchAll(/^(?:error: self\.md: |fail: .*self\.md: )(.*)$/gm)].map((m) => m[1]);

test('P2 self check and check-pr give each world2 self case the reference checker\'s errors, and chore pr refuses or pushes as it says (kit-862)', withProject('p-cases', {}, async (W, check) => {
  const oracle = (text) => refCheckSelf(text, { root: P, has: W.has }).errors;
  await check('P2 self check: each case\'s errors, exit 1 only with one', () => {
    assert.equal(SURFACE.filter((c) => oracle(c.text).some((e) => e.includes('leaves the repo'))).length, 2, 'P2 two texts leave the fixture\'s repo');
    for (const c of SURFACE) {
      write(path.join(W.old, SELF), c.text);
      const want = oracle(c.text);
      const r = W.run(['self', 'check']);
      assert.deepEqual(selfErrors(r.out), want, `P2 self check on ${c.name}\n${r.out}`);
      assert.equal(r.status, want.length ? 1 : 0, `P2 self check's exit on ${c.name}\n${r.out}`);
    }
    W.g(['checkout', '--', SELF], W.old);
  });
  await check('P3 check-pr: each case\'s errors, at its own commit', () => {
    const w = path.join(W.old, '.worktrees', 'chore-cases');
    W.g(['worktree', 'add', '-q', '-b', 'chore-cases', w, 'origin/main'], W.old);
    write(path.join(W.old, 'docs/devteam/run/pr/chore-cases.md'), '# chore-cases: x\n\n## One-way doors\n\nNone.\n');
    for (const c of SURFACE) {
      write(path.join(w, SELF), c.text);
      W.g(['add', '-A'], w);
      W.g(['commit', '-qm', c.name, '--allow-empty'], w);
      W.g(['push', '-qf', 'origin', 'chore-cases'], w);
      const sha = W.g(['rev-parse', 'HEAD'], w);
      const want = oracle(c.text);
      const r = W.checkPr('chore-cases', sha);
      const got = [...r.text.matchAll(/^fail: .*self\.md(?: breaks self@\d at [0-9a-f]{12})?: (.*)$/gm)].map((m) => m[1]);
      assert.deepEqual(got, want, `P3 check-pr on ${c.name}\n${r.text}`);
    }
  });
  await check('P4 chore pr refuses each text the reference refuses, with its errors, pushing nothing new; pushes each it passes', () => {
    let last = null; // the chore's tip on origin
    for (const c of SURFACE) {
      const want = oracle(c.text);
      const r = W.chorePr('drafts', (w) => write(path.join(w, SELF), c.text));
      for (const e of want) assert.ok(r.text.includes(`self.md: ${e}`), `P4 chore pr on ${c.name} says "${e}"\n${r.text}`);
      assert.equal(r.status === 0, !want.length, `P4 chore pr ${want.length ? 'refuses' : 'pushes'} ${c.name}\n${r.text}`);
      const tip = W.g(['ls-remote', 'origin', 'refs/heads/chore-drafts'], W.old).split('\t')[0] || null;
      assert.equal(tip, want.length ? last : r.sha(), `P4 ${c.name}: ${want.length ? 'nothing pushed' : 'its draft pushed'}`);
      last = tip;
    }
  });
}));

