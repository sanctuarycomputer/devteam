// kit-135: project/exterior.md, what the project relates to (exterior@1). The supervisor drafts it
// from the strategy and self.md: each entity by its relation, why it matters, its weight and the
// signals that show it. exterior show and exterior check read it, validate refuses one that breaks
// the contract, the strategy and self blobs and quotes are checked at the draft only, the names rule
// holds a draft on a repo not known to be private, and metrics raises exterior-drift, exterior-stale
// and exterior-missing. Each assertion names its check (A1…) in the spec's acceptance table.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { json, write } from './lib/kit.mjs';
import { fixture, SUP } from './lib/next-step-fixture.mjs';

const P = 'docs/devteam/project';
const SELF = `${P}/self.md`;
const STRAT = `${P}/strategy.md`;
const EXT = `${P}/exterior.md`;
const world = (f) => fs.readFileSync(new URL(`./fixtures/world/${f}`, import.meta.url), 'utf8');
const SELF_MD = world('self.md');
const STRATEGY = world('strategy.md');
const EXTERIOR_MD = world('exterior.md');
const CASES = JSON.parse(world('invalid/cases.json')).filter((c) => c.file.startsWith('exterior-'));
// the paths the fixture self.md's parts name, as files on main
const PARTS = { 'app/main.js': 'app\n', 'app/plugins/api.js': 'api\n', 'sync/server.js': 'sync\n', 'deploy/sync.yml': 'deploy\n' };
const re = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

// A fixture project (kit-139's shape): main holds strategy (null: init's template), self.md and
// exterior.md (null: none) and the parts' files; a gh on PATH answers `gh repo view acme/quillmark`
// with the visibility set (unknown, or any other repo: it fails).
function proj(name, { strategy = STRATEGY, self = SELF_MD, exterior = null, files = PARTS, visibility = 'unknown' } = {}) {
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
  const runIn = (cwd, args, env = ENV) => { const r = F.run(cwd, args, env); return { status: r.status, out: r.out, err: r.err, text: `${r.out}\n${r.err}` }; };
  const run = (args, env = ENV) => runIn(old, args, env);
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
  onMain({ ...(strategy === null ? {} : { [STRAT]: strategy }), ...(self === null ? {} : { [SELF]: self }), ...(exterior === null ? {} : { [EXT]: exterior }), ...files }, 'fixture');
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
  const writeTree = (rel, text) => (text === null ? fs.rmSync(path.join(old, rel), { force: true }) : write(path.join(old, rel), text));
  return { ...F, run, runIn, ok, onMain, blob, chorePr, branchOf, checkPr, findings, setVisibility, writeTree, ENV };
}

// Each check is a subtest of its fixture's test, so one red check leaves the next to run.
const withProject = (name, opts, body) => async (t) => {
  const W = proj(name, opts);
  try { await body(W, (title, fn) => t.test(title, fn)); } finally { W.done(); }
};

test('A5 A8 exterior check and validate hold the contract', withProject('exterior-contract', {}, async (W, check) => {
  await check('A5 every exterior case is refused by exterior check and validate', () => {
    const cases = [
      ...CASES.map((c) => ({ name: c.file, text: world(`invalid/${c.file}`), expect: c.expect })),
      { name: 'inline unclosed', text: '# Exterior\n\n```exterior\n{ "exterior": 1 }\n', expect: 'never closes' },
      { name: 'inline array', text: '# Exterior\n\n```exterior\n[]\n```\n', expect: 'not a JSON object' },
    ];
    let ran = 0;
    for (const c of cases) {
      W.writeTree(EXT, c.text);
      const x = W.run(['exterior', 'check']);
      assert.equal(x.status, 1, `A5 exterior check exits 1 for ${c.name}\n${x.text}`);
      assert.match(x.out, new RegExp(`error: exterior\\.md: .*${re(c.expect)}`), `A5 exterior check says why for ${c.name}\n${x.out}`);
      const v = W.run(['validate']);
      assert.notEqual(v.status, 0, `A5 validate refuses ${c.name}\n${v.text}`);
      assert.match(v.out, new RegExp(`exterior\\.md: .*${re(c.expect)}`), `A5 validate says why for ${c.name}\n${v.out}`);
      ran += 1;
    }
    assert.equal(ran, 28, 'A5 ran every exterior case and the two inline ones');
  });
  await check('A8 no exterior.md passes exterior check and validate', () => {
    W.writeTree(EXT, null);
    const x = W.run(['exterior', 'check']);
    assert.equal(x.status, 0, `A8 exterior check exits 0 with no exterior.md\n${x.text}`);
    assert.match(x.out, /no exterior\.md: nothing to check/, 'A8 exterior check says there is nothing to check');
    assert.doesNotMatch(W.run(['validate']).out, /exterior\.md/, 'A8 validate says nothing about a missing exterior.md');
    W.writeTree(EXT, world('exterior-empty.md'));
    const e = W.run(['exterior', 'check']);
    assert.equal(e.status, 0, `A8 exterior check passes an exterior.md with no entities\n${e.text}`);
    W.writeTree(EXT, null);
  });
}));

// the fixture exterior.md with its block changed
const extBlock = (edit, text = EXTERIOR_MD) => text.replace(/```exterior\n([\s\S]*?)\n```/, (_, b) => { const v = JSON.parse(b); edit(v); return `\`\`\`exterior\n${JSON.stringify(v, null, 2)}\n\`\`\``; });

test('A6 the quotes and strategy_blob', withProject('exterior-strategy', {}, async (W, check) => {
  await check('A6 a quote not in the strategy is refused by exterior check and validate', () => {
    W.writeTree(EXT, extBlock((v) => { v.entities[1].strategy[0] = 'Sync runs on Acme Storage, so it must stay fast and cheaq.'; }));
    const x = W.run(['exterior', 'check']);
    assert.equal(x.status, 1, `A6 exterior check refuses a changed quote\n${x.text}`);
    assert.match(x.out, /not found in strategy\.md at d4b0bd76/, 'A6 exterior check names the quote\'s strategy blob');
    const v = W.run(['validate']);
    assert.notEqual(v.status, 0, `A6 validate refuses a changed quote\n${v.text}`);
    assert.match(v.out, /exterior\.md: .*not found in strategy\.md at d4b0bd76/, 'A6 validate names the quote\'s strategy blob');
  });
  await check('A6 a strategy_blob holding every quote but not the head\'s strategy.md is refused at the draft', () => {
    const f = path.join(W.base, 'strategy-plus.md');
    fs.writeFileSync(f, `${STRATEGY}\nOne more line.\n`);
    const other = W.g(['hash-object', '-w', f], W.old);
    W.writeTree(EXT, extBlock((v) => { v.strategy_blob = other; }));
    const x = W.run(['exterior', 'check']);
    assert.equal(x.status, 1, `A6 exterior check refuses another strategy blob\n${x.text}`);
    assert.match(x.out, /strategy_blob is not the head's strategy\.md/, 'A6 exterior check says draft from the head\'s strategy');
  });
  await check('A6 a strategy_blob the repo can\'t read is an error at the draft and a warning on main', () => {
    const zero = extBlock((v) => { v.strategy_blob = '0'.repeat(40); });
    W.writeTree(EXT, zero);
    const x = W.run(['exterior', 'check']);
    assert.equal(x.status, 1, `A6 exterior check refuses an unreadable strategy_blob\n${x.text}`);
    assert.match(x.out, /error: exterior\.md: .*can't read/, 'A6 exterior check says it can\'t read the blob');
    W.onMain({ [EXT]: zero }, 'exterior.md with an unreadable strategy_blob');
    const v = W.run(['validate']);
    assert.equal(v.status, 0, `A6 validate on main only warns of an unreadable strategy_blob\n${v.text}`);
    assert.match(v.out, /exterior\.md: .*can't read/, `A6 validate warns of the unreadable blob\n${v.out}`);
    assert.doesNotMatch(v.out, /error: .*exterior\.md/, 'A6 validate has no exterior.md error on main');
    W.onMain({ [EXT]: null }, 'no exterior.md');
  });
}));

test('A7 self_blob at the draft only', withProject('exterior-self', {}, async (W, check) => {
  await check('A7 a self_blob not the head\'s self.md is refused at the draft', () => {
    W.writeTree(EXT, extBlock((v) => { v.self_blob = 'c69d5ece56a6aa7dd72e1257f0eac0892e0c73c1'; }));
    for (const args of [['exterior', 'check'], ['validate']]) {
      const r = W.run(args);
      assert.notEqual(r.status, 0, `A7 ${args[0]} refuses another self_blob\n${r.text}`);
      assert.match(r.out, /exterior\.md: .*not the head's self\.md/, `A7 ${args[0]} says self_blob is not the head's self.md\n${r.out}`);
    }
  });
  await check('A7 with no self.md at the head, draw self.md first', () => {
    W.writeTree(EXT, EXTERIOR_MD);
    W.writeTree(SELF, null);
    const r = W.run(['exterior', 'check']);
    assert.equal(r.status, 1, `A7 exterior check refuses with no self.md\n${r.text}`);
    assert.match(r.out, /draw self\.md first/, 'A7 exterior check says draw self.md first');
    W.g(['checkout', '--', SELF], W.old);
  });
  await check('A7 on main, a later self.md change leaves validate passing', () => {
    W.onMain({ [EXT]: EXTERIOR_MD }, 'exterior.md');
    W.onMain({ [SELF]: `${SELF_MD}\nIt also keeps a changelog.\n` }, 'self.md moves on');
    const v = W.run(['validate']);
    assert.equal(v.status, 0, `A7 validate passes on main after self.md moved on\n${v.text}`);
    assert.doesNotMatch(v.out, /exterior\.md/, 'A7 validate says nothing of exterior.md on main');
  });
  await check('A7 with no main to read, validate is not at the draft', () => {
    W.g(['push', '-q', 'origin', 'HEAD:refs/heads/side'], W.old);
    const c = path.join(W.base, 'side-clone');
    W.g(['clone', '-q', '--single-branch', '--branch', 'side', W.org, c], W.base);
    W.g(['remote', 'remove', 'origin'], c);
    const x = W.runIn(c, ['validate']);
    assert.equal(x.status, 0, `A7 validate in a clone with no main passes\n${x.text}`);
    assert.doesNotMatch(x.out, /exterior\.md/, `A7 validate in a clone with no main says nothing of exterior.md\n${x.out}`);
  });
}));
