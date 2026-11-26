// kit-135: project/exterior.md, what the project relates to; since kit-863 a plain document
// (exterior@2), each ### entry with a dated source. exterior show prints main's; exterior check, chore
// pr and check-pr refuse a draft holding a version 1 block, and on a repo not known to be private hold
// a ### heading main's strategy or dependency names don't name whole, and each other capitalised word
// and link host until named on the chore. A version 1 file still validates by its contract (its
// quotes and blobs at the draft). metrics raises exterior-drift, exterior-stale and exterior-missing.
// Each assertion names its check (A1…) in kit-135's acceptance table, as kit-863 moved it.
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
// the paths the version 1 fixture self.md's parts name (and PLAIN_SELF's links reach), as files on main
const PARTS = { 'app/main.js': 'app\n', 'app/plugins/api.js': 'api\n', 'sync/server.js': 'sync\n', 'deploy/sync.yml': 'deploy\n' };
// the fixture self.md as a plain draft (self@2, kit-862): its block gone, its parts linked; a draft
// of version 1 is refused, though main's version 1 file still validates
const PLAIN_SELF = SELF_MD.replace(/\n```self\n[\s\S]*?\n```\n?/, '\n').replace('Its parts are the app people write in, the sync service', 'Its parts are [the app](../../../app/) people write in, [the sync service](../../../sync/)');
const re = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
// a read date three days back, so every dated source is in range whatever day the test runs
const DAY = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
// the fixture strategy naming the one host the plain fixtures' sources use (its blob is not
// EXTERIOR_MD's strategy_blob, so version 1 checks keep STRATEGY)
const STRATEGY_PLAIN = `${STRATEGY}- Its own pages, at quillmark.example, say what it ships.\n`;
const src = (what, page) => `([${what}](https://quillmark.example/${page}), read ${DAY})`;
// a plain exterior.md (exterior@2) on the strategy: each ### entry a name it gives, each capitalised
// word in it, each source on quillmark.example
const PLAIN_EXT = `# Exterior

What Quillmark relates to, by how each relates to it.

## Who it serves

### Independent researchers

They write long notes and want them to last ${src('notes', 'researchers')}.

## What it depends on

### Acme Storage

Sync runs on it, so its prices and its outages are ours ${src('prices', 'acme')}.

## What builds on it

### Inkwell Plugins

The plugins people ask for most ${src('plugins', 'inkwell')}.

## Its alternative

### Ledgerpad

It does the same job and locks notes in ${src('compare', 'ledgerpad')}.
`;
// the plain fixture with one more entry, headed by a name nothing gives
const ZENTRIX = `${PLAIN_EXT}\n## Who it works with\n\n### Zentrix Labs\n\nIt sponsors the yearly meetup ${src('meetup', 'meetup')}.\n`;
// a plain exterior.md of one ### entry
const onePlain = (heading, prose = 'It matters here') => `# Exterior\n\nWhat Quillmark relates to.\n\n## Who it serves\n\n### ${heading}\n\n${prose} ${src('notes', 'x')}.\n`;

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

// exterior check's refusal of a draft holding a version 1 block (exterior@2 has none)
const BLOCK = /^error: exterior\.md: exterior\.md holds a fenced exterior block at line \d+: a plain document has none$/m;

test('A5 A8 exterior check and validate hold the contract', withProject('exterior-contract', {}, async (W, check) => {
  await check('A5 every version 1 case: exterior check refuses its block, validate its contract; a file with no block is plain', () => {
    const cases = [
      ...CASES.map((c) => ({ name: c.file, text: world(`invalid/${c.file}`), expect: c.expect })),
      { name: 'inline unclosed', text: '# Exterior\n\n```exterior\n{ "exterior": 1 }\n', expect: 'never closes' },
      { name: 'inline array', text: '# Exterior\n\n```exterior\n[]\n```\n', expect: 'not a JSON object' },
    ];
    let ran = 0;
    for (const c of cases) {
      W.writeTree(EXT, c.text);
      const x = W.run(['exterior', 'check']);
      if (c.name === 'exterior-no-block.md') {
        // no block: a plain document of a title and prose (exterior@2), which both pass
        assert.equal(x.status, 0, `A5 exterior check passes ${c.name}, a plain file\n${x.text}`);
        assert.equal(W.run(['validate']).status, 0, `A5 validate passes ${c.name}, a plain file`);
        ran += 1;
        continue;
      }
      assert.equal(x.status, 1, `A5 exterior check exits 1 for ${c.name}\n${x.text}`);
      assert.match(x.out, BLOCK, `A5 exterior check refuses the version 1 block of ${c.name}\n${x.out}`);
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
    assert.equal(e.status, 1, `A8 exterior check refuses a version 1 exterior.md with no entities\n${e.text}`);
    assert.match(e.out, BLOCK, 'A8 by its block');
    assert.equal(W.run(['validate']).status, 0, 'A8 validate passes it (version 1, valid)');
    W.writeTree(EXT, null);
  });
}));

// the fixture exterior.md with its block changed
const extBlock = (edit, text = EXTERIOR_MD) => text.replace(/```exterior\n([\s\S]*?)\n```/, (_, b) => { const v = JSON.parse(b); edit(v); return `\`\`\`exterior\n${JSON.stringify(v, null, 2)}\n\`\`\``; });

test('A6 the quotes and strategy_blob', withProject('exterior-strategy', {}, async (W, check) => {
  await check('A6 a quote not in the strategy is refused by validate (exterior check: by its block)', () => {
    W.writeTree(EXT, extBlock((v) => { v.entities[1].strategy[0] = 'Sync runs on Acme Storage, so it must stay fast and cheaq.'; }));
    const x = W.run(['exterior', 'check']);
    assert.equal(x.status, 1, `A6 exterior check refuses the version 1 draft\n${x.text}`);
    assert.match(x.out, BLOCK, 'A6 exterior check refuses its block');
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
    assert.equal(x.status, 1, `A6 exterior check refuses the version 1 draft\n${x.text}`);
    assert.match(x.out, BLOCK, 'A6 exterior check refuses its block');
    const v = W.run(['validate']);
    assert.notEqual(v.status, 0, `A6 validate refuses another strategy blob\n${v.text}`);
    assert.match(v.out, /exterior\.md: .*strategy_blob is not the head's strategy\.md/, 'A6 validate says draft from the head\'s strategy');
  });
  await check('A6 a strategy_blob the repo can\'t read is an error at the draft and a warning on main', () => {
    const zero = extBlock((v) => { v.strategy_blob = '0'.repeat(40); });
    W.writeTree(EXT, zero);
    const x = W.run(['exterior', 'check']);
    assert.equal(x.status, 1, `A6 exterior check refuses the version 1 draft\n${x.text}`);
    assert.match(x.out, BLOCK, 'A6 exterior check refuses its block');
    const d = W.run(['validate']);
    assert.notEqual(d.status, 0, `A6 validate refuses an unreadable strategy_blob at the draft\n${d.text}`);
    assert.match(d.out, /error: .*exterior\.md: .*can't read/, 'A6 validate says it can\'t read the blob');
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
    const x = W.run(['exterior', 'check']);
    assert.equal(x.status, 1, `A7 exterior check refuses the version 1 draft\n${x.text}`);
    assert.match(x.out, BLOCK, 'A7 exterior check refuses its block');
    const r = W.run(['validate']);
    assert.notEqual(r.status, 0, `A7 validate refuses another self_blob\n${r.text}`);
    assert.match(r.out, /exterior\.md: .*not the head's self\.md/, `A7 validate says self_blob is not the head's self.md\n${r.out}`);
  });
  await check('A7 with no self.md at the head: a version 1 draft, draw self.md first; a plain one needs none', () => {
    W.writeTree(EXT, EXTERIOR_MD);
    W.writeTree(SELF, null);
    const v = W.run(['validate']);
    assert.notEqual(v.status, 0, `A7 validate refuses with no self.md\n${v.text}`);
    assert.match(v.out, /exterior\.md: there is no self\.md at the head: draw self\.md first/, 'A7 validate says draw self.md first');
    assert.match(W.run(['exterior', 'check']).out, BLOCK, 'A7 exterior check refuses its block');
    W.writeTree(EXT, PLAIN_EXT);
    const p = W.run(['exterior', 'check']);
    assert.equal(p.status, 0, `A7 a plain draft with no self.md passes exterior check (exterior@2 has no self rule)\n${p.text}`);
    W.writeTree(EXT, null);
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

const DATA = JSON.parse(world('dashboard-data.json'));

test('A1 A2 A3 A4 A8 exterior show, dashboard-data and search read exterior.md', withProject('exterior-show', { exterior: EXTERIOR_MD }, async (W, check) => {
  await check('A1 show prints main\'s exterior.md as it is, either version', () => {
    const s1 = W.run(['exterior', 'show']);
    assert.equal(s1.status, 0, `A1 exterior show exits 0\n${s1.text}`);
    assert.equal(s1.out, `Exterior: ${EXT} on main\n\n${EXTERIOR_MD.trimEnd()}`, 'A1 a version 1 file, printed as it is');
    W.writeTree(EXT, PLAIN_EXT);
    assert.equal(W.run(['exterior', 'show']).out, `Exterior: ${EXT} on main\n\n${EXTERIOR_MD.trimEnd()}`, 'A1 main\'s, whatever the working tree holds');
    W.g(['checkout', '--', EXT], W.old);
    W.onMain({ [EXT]: PLAIN_EXT }, 'a plain exterior.md');
    assert.equal(W.run(['exterior', 'show']).out, `Exterior: ${EXT} on main\n\n${PLAIN_EXT.trimEnd()}`, 'A1 a plain file, printed as it is');
    W.onMain({ [EXT]: EXTERIOR_MD }, 'exterior.md again');
  });
  await check('A2 show --json is the contract\'s dashboard block', () => {
    const j = W.run(['exterior', 'show', '--json']);
    assert.deepEqual(j.status === 0 ? JSON.parse(j.out) : j.text, DATA.exterior, 'A2 exterior show --json is the dashboard exterior block');
  });
  await check('A3 dashboard-data carries main\'s exterior.md, or null', () => {
    assert.deepEqual(json(W.ok(['dashboard-data'])).exterior, DATA.exterior, 'A3 dashboard-data carries main\'s exterior block');
    W.onMain({ [EXT]: world('invalid/exterior-bad-relation.md') }, 'an invalid exterior.md');
    W.writeTree(EXT, EXTERIOR_MD);
    assert.equal(json(W.ok(['dashboard-data'])).exterior, null, 'A3 dashboard-data is null when main\'s exterior.md breaks the contract, whatever the working tree holds');
    W.g(['checkout', '--', EXT], W.old);
    W.onMain({ [EXT]: null }, 'no exterior.md');
    assert.equal(json(W.ok(['dashboard-data'])).exterior, null, 'A3 dashboard-data is null with no exterior.md on main');
    W.onMain({ [EXT]: PLAIN_EXT }, 'a plain exterior.md');
    assert.equal(json(W.ok(['dashboard-data'])).exterior, null, 'A3 dashboard-data is null for a plain exterior.md (it has no block)');
    W.onMain({ [EXT]: EXTERIOR_MD }, 'exterior.md again');
  });
  await check('A4 search finds a word of exterior.md', () => {
    const s = W.run(['search', 'outages', '--type', 'doc']);
    assert.match(s.out, /exterior\.md/, `A4 search "outages" finds exterior.md\n${s.text}`);
  });
  await check('A8 show with no exterior.md on main, and with no entity', () => {
    W.onMain({ [EXT]: null }, 'no exterior.md');
    const s = W.run(['exterior', 'show']);
    assert.equal(s.status, 0, `A8 exterior show exits 0 with no exterior.md\n${s.text}`);
    assert.match(s.out, /exterior\.md is not drafted yet/, 'A8 exterior show says not drafted yet');
    assert.equal(W.run(['exterior', 'show', '--json']).out.trim(), 'null', 'A8 exterior show --json prints null');
    W.onMain({ [EXT]: world('exterior-empty.md') }, 'an exterior.md with no entity');
    assert.ok(W.run(['exterior', 'show']).out.includes(world('exterior-empty.md').trimEnd()), 'A8 a file with no entity prints as it is');
    W.onMain({ [EXT]: EXTERIOR_MD }, 'exterior.md again');
  });
}));

// A version 1 exterior.md of one entity, the prose naming it; on main's strategy and the fixture
// self.md (for main only: a draft is plain).
const oneEntity = (W, entity, prose = `It relates to ${entity.name}.`) => `# Exterior\n\n${prose}\n\n\`\`\`exterior\n${JSON.stringify({
  exterior: 1, strategy_blob: W.blob(STRAT), self_blob: W.blob(SELF),
  entities: [{ id: 'x', matters: 'It matters.', weight: 1, strategy: ['Independent researchers who write long notes and want them to last.'], signals: [], ...entity }],
}, null, 2)}\n\`\`\`\n`;
const NOT_NAMED = /\(a ### heading\) is not named whole in origin main's strategy/;

test('A9 exterior check holds an unnamed ### heading by visibility', withProject('exterior-names-vis', { strategy: STRATEGY_PLAIN }, async (W, check) => {
  await check('A9 public and unknown: an error; private: nothing', () => {
    W.writeTree(EXT, ZENTRIX);
    const words = /"Zentrix Labs" \(a ### heading\) is not named whole in origin main's strategy\.md or its dependency names/;
    W.setVisibility('public');
    const p = W.run(['exterior', 'check']);
    assert.equal(p.status, 1, `A9 public: exterior check exits 1\n${p.text}`);
    assert.match(p.out, new RegExp(`^error: exterior\\.md: ${words.source}`, 'm'), 'A9 public: an error naming Zentrix Labs');
    W.setVisibility('unknown');
    const u = W.run(['exterior', 'check']);
    assert.equal(u.status, 1, `A9 unknown: exterior check exits 1\n${u.text}`);
    assert.match(u.out, new RegExp(`^error: exterior\\.md: ${words.source}.*\\(the repo's visibility is unknown`, 'm'), 'A9 unknown: an error naming Zentrix Labs, saying the visibility is unknown');
    W.setVisibility('private');
    const q = W.run(['exterior', 'check']);
    assert.equal(q.status, 0, `A9 private: exterior check exits 0\n${q.text}`);
    assert.doesNotMatch(q.out, /Zentrix/, `A9 private: no names-rule line and no word line\n${q.out}`);
    W.writeTree(EXT, null);
  });
  await check('A9 the plain fixture, every name and host in the strategy, passes clean on a public repo', () => {
    W.setVisibility('public');
    W.writeTree(EXT, PLAIN_EXT);
    const r = W.run(['exterior', 'check']);
    assert.equal(r.status, 0, `A9 the fixture passes exterior check\n${r.text}`);
    assert.doesNotMatch(r.out, /^(warn|error):/m, `A9 the fixture draws no line\n${r.out}`);
    W.writeTree(EXT, null);
  });
}));

test('A12 focus 3 focus 4 the names rule\'s cases', withProject('exterior-names-cases', {
  visibility: 'public',
  strategy: `${STRATEGY_PLAIN}- It reads from the zorblat archive.\n- The C++ Guild reviews its plugin interface.\n`,
  files: { ...PARTS, 'package.json': JSON.stringify({ dependencies: { lodash: '1' }, devDependencies: { moment: '1', 'node.js': '1' } }), Gemfile: "source 'https://rubygems.org'\ngem 'rails'\n  gem \"faraday\", '~> 2'\ngem(\"puma\")\n", 'requirements.txt': '# pinned\nrequests==2.0\n' },
}, async (W, check) => {
  const run = (heading, prose) => { W.writeTree(EXT, onePlain(heading, prose)); return W.run(['exterior', 'check']); };
  const allowed = (why, heading) => {
    const r = run(heading);
    assert.equal(r.status, 0, `A12 allowed: ${why}\n${r.text}`);
    assert.doesNotMatch(r.out, NOT_NAMED, `A12 allowed: ${why}: no names-rule line\n${r.out}`);
  };
  const refused = (why, heading) => {
    const r = run(heading);
    assert.equal(r.status, 1, `A12 refused: ${why}\n${r.text}`);
    const words = `"${heading}" (a ### heading) is not named whole in origin main's strategy.md or its dependency names`;
    assert.ok(r.out.includes(`error: exterior.md: ${words}`), `A12 refused: ${why}: the rule's words\n${r.out}`);
  };
  await check('A12 allowed: in lower case in main\'s strategy', () => allowed('lower case', 'Zorblat Archive'));
  await check('A12 allowed: a name in the dependency files (a plain file has no relation to require)', () => {
    for (const name of ['lodash', 'moment', 'rails', 'faraday', 'puma', 'requests']) allowed(`dependency ${name}`, name);
  });
  await check('A12 refused: substrings, and the branch\'s own strategy', () => {
    refused('a longer word', 'Acme Storages');
    refused('a prefixed word', 'XAcme Storage');
    refused('a name nothing gives', 'Zentrix Labs');
    W.writeTree(STRAT, `${fs.readFileSync(path.join(W.old, STRAT), 'utf8')}- It works with Zentrix Labs.\n`);
    W.writeTree(EXT, onePlain('Zentrix Labs'));
    const r = W.run(['exterior', 'check']);
    assert.equal(r.status, 1, `A12 refused: named only in the branch's strategy\n${r.text}`);
    assert.match(r.out, /^error: exterior\.md: "Zentrix Labs" \(a ### heading\) is not named whole in origin main's strategy\.md/m, 'A12 refused: the branch\'s strategy allows nothing');
    W.g(['checkout', '--', STRAT], W.old);
  });
  await check('A12 a word in prose is held as a word, never the heading rule', () => {
    // the name starts its sentence, so only the capitalised-word check (first word included) sees it
    const r = run('Independent researchers', 'Zentrix customers are who it serves');
    assert.equal(r.status, 0, `A12 warned: prose naming Zentrix exits 0\n${r.text}`);
    assert.match(r.out, /^warn: exterior\.md: "Zentrix" \(word\)/m, 'A12 warned: the word Zentrix');
    assert.doesNotMatch(r.out, NOT_NAMED, 'A12 prose is never checked by the heading rule');
    W.onMain({ [STRAT]: `${fs.readFileSync(path.join(W.old, STRAT), 'utf8')}- Zentrix shops sell it.\n` }, 'strategy names Zentrix');
    const a = run('Independent researchers', 'Zentrix customers are who it serves');
    assert.equal(a.status, 0, `A12 allowed: Zentrix with Zentrix in main's strategy\n${a.text}`);
    assert.doesNotMatch(a.out, /"Zentrix"/, `A12 allowed: no warning once main's strategy names Zentrix\n${a.out}`);
  });
  await check('focus 4 names with regex characters', () => {
    allowed('C++ Guild in the strategy', 'C++ Guild');
    allowed('Node.js in package.json', 'Node.js');
  });
  await check('focus 3 a package.json that is not JSON, or whose dependencies is a list', () => {
    W.onMain({ 'package.json': '{not json' }, 'a broken package.json');
    const r = run('Zorblat Archive');
    assert.equal(r.status, 0, `focus 3 a broken package.json is no crash\n${r.text}`);
    assert.equal(r.out.split('\n').filter((l) => /^warn: .*package\.json/.test(l)).length, 1, `focus 3 one warning names package.json\n${r.out}`);
    W.onMain({ 'package.json': JSON.stringify({ dependencies: ['lodash'] }) }, 'dependencies as a list');
    refused('a list of dependencies gives no names', 'lodash');
  });
}));

// the live log's lines
const logLines = (W) => { const d = path.join(W.old, 'docs/devteam/run/log'); return fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.endsWith('.jsonl')).flatMap((f) => fs.readFileSync(path.join(d, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))) : []; };
const namesActs = (W) => logLines(W).filter((o) => o.type === 'act' && o.class === 'names-checked');
// the version 1 fixture with one more clause of prose, every word in the strategy (a version 1 draft)
const REWORDED_V1 = EXTERIOR_MD.replace('locks notes in.', 'locks notes in, which researchers dislike.');
// the plain fixture with one more clause of prose, every word in the strategy
const REWORDED = PLAIN_EXT.replace('locks notes in', 'locks notes in, which researchers dislike');
const inWt = (W, slug) => path.join(W.old, '.worktrees', `chore-${slug}`);
const writeIn = (w, rel, text) => write(path.join(w, rel), text);
const commitIn = (W, w, msg) => { W.g(['add', '-A'], w); W.g(['commit', '-qm', msg], w); return W.g(['rev-parse', 'HEAD'], w); };

test('A10 chore pr pushes nothing it refuses, in any commit since main', withProject('exterior-chore', { exterior: PLAIN_EXT, strategy: STRATEGY_PLAIN, visibility: 'public' }, async (W, check) => {
  const main = () => W.g(['rev-parse', 'origin/main'], W.old);
  await check('A10 public and unknown: refused before any commit, nothing pushed', () => {
    for (const [slug, vis] of [['zp', 'public'], ['zu', 'unknown']]) {
      W.setVisibility(vis);
      const p = W.chorePr(slug, (w) => writeIn(w, EXT, ZENTRIX));
      assert.equal(p.status, 1, `A10 ${vis}: chore pr refuses\n${p.text}`);
      assert.match(p.text, /Zentrix Labs/, `A10 ${vis}: naming Zentrix Labs`);
      if (vis === 'unknown') assert.match(p.text, /visibility is unknown/, 'A10 unknown: says the visibility is unknown');
      assert.equal(p.pushed(), false, `A10 ${vis}: nothing pushed`);
      assert.equal(p.sha(), main(), `A10 ${vis}: no commit made`);
    }
  });
  await check('A10 --names-checked never clears the names rule', () => {
    W.setVisibility('public');
    const p = W.chorePr('zp', () => {}, ['--names-checked', 'Zentrix,Labs']);
    assert.equal(p.status, 1, `A10 --names-checked: still refused\n${p.text}`);
    assert.match(p.text, /"Zentrix Labs" \(a ### heading\) is not named whole/, 'A10 the names rule still speaks');
    assert.equal(p.pushed(), false, 'A10 --names-checked: nothing pushed');
  });
  await check('A10 private: pushed', () => {
    W.setVisibility('private');
    const p = W.chorePr('zv', (w) => writeIn(w, EXT, ZENTRIX));
    assert.equal(p.status, 0, `A10 private: chore pr pushes\n${p.text}`);
    assert.equal(p.pushed(), true, 'A10 private: pushed');
    W.setVisibility('public');
  });
  await check('A10 history 1: a name in a hand commit refuses before chore pr commits', () => {
    W.ok(['chore', 'start', 'h1']);
    const w = inWt(W, 'h1');
    writeIn(w, EXT, ZENTRIX);
    const hand = commitIn(W, w, 'a draft, by hand');
    const p = W.chorePr('h1', (x) => writeIn(x, EXT, REWORDED));
    assert.equal(p.status, 1, `A10 history 1: refused\n${p.text}`);
    assert.ok(p.text.includes(hand.slice(0, 12)), `A10 history 1: names the hand commit ${hand.slice(0, 12)}\n${p.text}`);
    assert.equal(p.sha(), hand, 'A10 history 1: no new commit');
    assert.equal(p.pushed(), false, 'A10 history 1: nothing pushed');
  });
  await check('A10 history 2: a name put back since is still refused, until the branch is rewritten', () => {
    W.ok(['chore', 'start', 'h2']);
    const w = inWt(W, 'h2');
    writeIn(w, EXT, ZENTRIX);
    const first = commitIn(W, w, 'a draft naming it');
    writeIn(w, EXT, PLAIN_EXT);
    commitIn(W, w, 'put back');
    const p = W.chorePr('h2', () => {});
    assert.equal(p.status, 1, `A10 history 2: refused\n${p.text}`);
    assert.ok(p.text.includes(first.slice(0, 12)), `A10 history 2: names ${first.slice(0, 12)}\n${p.text}`);
    assert.equal(p.pushed(), false, 'A10 history 2: nothing pushed');
    W.g(['reset', '-q', '--soft', 'origin/main'], w);
    const q = W.chorePr('h2', (x) => writeIn(x, EXT, REWORDED));
    assert.equal(q.status, 0, `A10 history 2: pushed once rewritten\n${q.text}`);
    assert.equal(q.pushed(), true, 'A10 history 2: pushed');
    assert.doesNotMatch(W.g(['log', '-p', 'origin/main..origin/chore-h2'], W.old) + W.g(['log', '-p', '-1', 'origin/chore-h2'], W.old), /Zentrix/, 'A10 history 2: the pushed branch never holds Zentrix');
  });
}));

test('A11 check-pr and merge --chore hold every commit of a PR changing exterior.md', withProject('exterior-checkpr', { exterior: PLAIN_EXT, strategy: STRATEGY_PLAIN, visibility: 'public' }, async (W, check) => {
  const plain = W.branchOf('chore-plain', (w) => writeIn(w, `${P}/designs/n.md`, 'n\n'));
  const baseline = W.checkPr('chore-plain', plain).status;
  assert.equal(baseline, 0, `check-pr passes a chore changing only a note\n${W.checkPr('chore-plain', plain).text}`);
  const zx = W.branchOf('chore-zx', (w) => writeIn(w, EXT, ZENTRIX));
  await check('A11 public: check-pr fails naming it', () => {
    const r = W.checkPr('chore-zx', zx);
    assert.equal(r.status, 1, `A11 public: check-pr fails\n${r.text}`);
    assert.match(r.text, /^fail: .*"Zentrix Labs" \(a ### heading\) is not named whole/m, 'A11 public: a fail naming Zentrix Labs');
  });
  await check('A11 unknown: check-pr warns, its exit unchanged', () => {
    W.setVisibility('unknown');
    const r = W.checkPr('chore-zx', zx);
    assert.equal(r.status, baseline, `A11 unknown: exit unchanged\n${r.text}`);
    assert.match(r.out, /^warn: .*"Zentrix Labs" \(a ### heading\) is not named whole/m, 'A11 unknown: a warning naming Zentrix Labs');
    W.setVisibility('public');
  });
  await check('A11 a range whose tip rewords it still fails on the earlier commit', () => {
    const w = path.join(W.old, '.worktrees', 'chore-zx');
    writeIn(w, EXT, REWORDED);
    const tip = commitIn(W, w, 'reworded');
    W.g(['push', '-q', 'origin', 'chore-zx'], w);
    const r = W.checkPr('chore-zx', tip);
    assert.equal(r.status, 1, `A11 the earlier commit fails check-pr\n${r.text}`);
    assert.ok(r.text.includes(zx.slice(0, 12)), `A11 naming the earlier commit ${zx.slice(0, 12)}\n${r.text}`);
  });
  await check('A11 merge --chore --dry-run fails the same', () => {
    const m = W.run(['merge', '--chore', 'zx', '--dry-run']);
    assert.notEqual(m.status, 0, `A11 merge --chore refuses\n${m.text}`);
    assert.match(m.text, /^(?!warn).*"Zentrix Labs" \(a ### heading\) is not named whole/m, 'A11 merge --chore names it, not as a warning');
  });
  await check('A11 a PR not changing exterior.md gets no exterior line, whatever main\'s names', () => {
    W.onMain({ [EXT]: oneEntity(W, { name: 'lodash', relation: 'depends_on', kind: 'work' }), 'package.json': JSON.stringify({ dependencies: { lodash: '1' } }) }, 'an exterior on a dependency');
    W.onMain({ 'package.json': JSON.stringify({ dependencies: {} }) }, 'the dependency removed');
    const deps = W.branchOf('chore-deps', (w) => writeIn(w, `${P}/designs/m.md`, 'm\n'));
    const r = W.checkPr('chore-deps', deps);
    assert.equal(r.status, 0, `A11 chore-deps passes check-pr\n${r.text}`);
    assert.doesNotMatch(r.text, /exterior\.md/, 'A11 chore-deps: no exterior.md line');
  });
}));

test('A16 focus 1 exterior.md\'s capitalised words are held as self.md\'s', withProject('exterior-words', { exterior: PLAIN_EXT, strategy: STRATEGY_PLAIN, visibility: 'public' }, async (W, check) => {
  const hosted = PLAIN_EXT.replace('It does the same job and locks notes in', 'It does the same job, which Zentrix hosts, and locks notes in');
  const G = W.goal('Billing', 1);
  W.feature('billing', G);
  W.ticket('billing-01-a', 'billing');
  const planSha = W.branchOf('plan/billing', (w) => writeIn(w, EXT, hosted));
  const ticketSha = W.branchOf('ticket/billing-01-a', (w) => writeIn(w, EXT, hosted));
  await check('A16 exterior check warns of the word', () => {
    W.writeTree(EXT, hosted);
    const r = W.run(['exterior', 'check']);
    assert.equal(r.status, 0, `A16 exterior check exits 0\n${r.text}`);
    assert.match(r.out, /^warn: exterior\.md: "Zentrix" \(word\)/m, 'A16 exterior check warns of the word Zentrix');
    W.g(['checkout', '--', EXT], W.old);
  });
  await check('A16 chore pr holds the word until --names-checked names it, then logs the act', () => {
    const p = W.chorePr('w', (w) => writeIn(w, EXT, hosted));
    assert.equal(p.status, 1, `A16 chore pr refuses the unchecked word\n${p.text}`);
    assert.match(p.text, /"Zentrix" \(word\)/, 'A16 naming the word');
    assert.equal(p.pushed(), false, 'A16 nothing pushed');
    const q = W.chorePr('w', () => {}, ['--names-checked', 'Zentrix']);
    assert.equal(q.status, 0, `A16 --names-checked Zentrix pushes\n${q.text}`);
    assert.equal(q.pushed(), true, 'A16 pushed');
    assert.deepEqual(namesActs(W).map((a) => [a.scope, [...a.refs].sort()]), [['exterior', ['chore-w', 'name:Zentrix']]], `A16 the act is logged with scope exterior\n${JSON.stringify(namesActs(W))}`);
    write(path.join(W.old, 'docs/devteam/run/pr/chore-w.md'), '# chore-w: x\n\n## One-way doors\n\nNone.\n');
    const k = W.checkPr('chore-w', q.sha());
    assert.equal(k.status, 0, `A16 check-pr passes the checked chore\n${k.text}`);
  });
  await check('A16 a plan or ticket PR with the word clears only by rewording', () => {
    for (const [ref, sha] of [['plan/billing', planSha], ['ticket/billing-01-a', ticketSha]]) {
      const r = W.checkPr(ref, sha);
      assert.notEqual(r.status, 0, `A16 ${ref} fails\n${r.text}`);
      assert.match(r.text, /^fail: .*names "Zentrix" \(word\)[^\n]*reword it/m, `A16 ${ref} fails on the word, saying reword it\n${r.text}`);
    }
  });
  await check('A16 a lower-case name in prose draws no line (the accepted P6 risk)', () => {
    W.writeTree(EXT, PLAIN_EXT.replace('locks notes in', 'locks notes in, and zentrix labs hosts it'));
    const r = W.run(['exterior', 'check']);
    assert.doesNotMatch(r.out, /zentrix/i, `A16 no line for a lower-case name\n${r.out}`);
    W.g(['checkout', '--', EXT], W.old);
  });
  await check('focus 1 one --names-checked for self.md and exterior.md: each held on its own words, an act per scope', () => {
    const both = (slug) => (w) => {
      const self = PLAIN_SELF.replace('It controls its code', 'It mails through Quux.\n\nIt controls its code');
      writeIn(w, SELF, self);
      writeIn(w, EXT, hosted);
      void slug;
    };
    const only = W.chorePr('both1', both('both1'), ['--names-checked', 'Zentrix']);
    assert.equal(only.status, 1, `focus 1 naming only Zentrix still refuses\n${only.text}`);
    assert.match(only.text, /Quux/, 'focus 1 on Quux');
    assert.equal(only.pushed(), false, 'focus 1 nothing pushed');
    const before = namesActs(W).length;
    const all = W.chorePr('both2', both('both2'), ['--names-checked', 'Quux,Zentrix']);
    assert.equal(all.status, 0, `focus 1 naming both pushes\n${all.text}`);
    const acts = namesActs(W).slice(before).map((a) => [a.scope, [...a.refs].sort()]).sort();
    assert.deepEqual(acts, [['exterior', ['chore-both2', 'name:Zentrix']], ['self', ['chore-both2', 'name:Quux']]], `focus 1 one act per scope\n${JSON.stringify(acts)}`);
  });
}));

test('focus 2 focus 5 a deleted exterior.md, and a branch with no merge base', withProject('exterior-edges', { exterior: EXTERIOR_MD, visibility: 'public' }, async (W, check) => {
  await check('focus 2 a branch deleting exterior.md gets no names line and no crash', () => {
    const sha = W.branchOf('chore-del', (w) => fs.rmSync(path.join(w, EXT)));
    const r = W.checkPr('chore-del', sha);
    assert.doesNotMatch(r.text, /TypeError|ReferenceError|at file:/, `focus 2 no crash\n${r.text}`);
    assert.doesNotMatch(r.text, /is not named|exterior\.md names|no merge base/, `focus 2 no exterior names line\n${r.text}`);
  });
  await check('focus 5 an orphan chore holding exterior.md: chore pr and check-pr refuse, naming why', () => {
    W.ok(['chore', 'start', 'orph']);
    const w = inWt(W, 'orph');
    W.g(['checkout', '-q', '--orphan', 'orph-tmp'], w);
    W.g(['commit', '-qm', 'unrelated history'], w);
    W.g(['branch', '-qf', 'chore-orph', 'orph-tmp'], w);
    W.g(['checkout', '-q', 'chore-orph'], w);
    const p = W.chorePr('orph', (x) => writeIn(x, EXT, REWORDED));
    assert.equal(p.status, 1, `focus 5 chore pr refuses\n${p.text}`);
    assert.match(p.text, /no merge base/, 'focus 5 chore pr says no merge base');
    assert.equal(p.pushed(), false, 'focus 5 nothing pushed');
    W.g(['push', '-q', 'origin', 'chore-orph'], w);
    write(path.join(W.old, 'docs/devteam/run/pr/chore-orph.md'), '# chore-orph: x\n\n## One-way doors\n\nNone.\n');
    const k = W.checkPr('chore-orph', W.g(['rev-parse', 'HEAD'], w));
    assert.equal(k.status, 1, `focus 5 check-pr refuses\n${k.text}`);
    assert.match(k.text, /no merge base with main: exterior\.md's drafts can't be checked/, 'focus 5 check-pr says no merge base');
  });
  await check('focus 5 an orphan without exterior.md gets no exterior line', () => {
    const w = inWt(W, 'orph');
    W.g(['checkout', '-q', '--', '.'], w);
    fs.rmSync(path.join(w, EXT), { force: true });
    W.g(['checkout', '-q', '--orphan', 'orph-bare'], w);
    W.g(['add', '-A'], w);
    W.g(['commit', '-qm', 'unrelated, no exterior.md'], w);
    W.g(['push', '-q', 'origin', 'orph-bare:chore-bare'], w);
    write(path.join(W.old, 'docs/devteam/run/pr/chore-bare.md'), '# chore-bare: x\n\n## One-way doors\n\nNone.\n');
    const k = W.checkPr('chore-bare', W.g(['rev-parse', 'HEAD'], w));
    assert.doesNotMatch(k.text, /exterior\.md/, `focus 5 no exterior line\n${k.text}`);
  });
}));

// a plain exterior.md whose two entries are headed by dependency names
const TWO_DEPS = `# Exterior\n\nWhat Quillmark relates to.\n\n## What it depends on\n\n### lodash\n\nThe app runs on it ${src('notes', 'lodash')}.\n\n### moment\n\nThe app runs on it too ${src('notes', 'moment')}.\n`;
const exteriorFindings = (W) => json(W.ok(['metrics', '--json'])).findings.filter((f) => f.kind.startsWith('exterior-'));

test('A13 exterior-drift once per heading a dependency no longer allows, where last known public', withProject('exterior-drift', { strategy: STRATEGY_PLAIN, files: { ...PARTS, 'package.json': JSON.stringify({ dependencies: { lodash: '1', moment: '1' } }) } }, async (W, check) => {
  W.onMain({ [EXT]: TWO_DEPS }, 'exterior.md on two dependencies');
  write(path.join(W.old, 'docs/devteam/run/repo-visibility.json'), JSON.stringify({ visibility: 'public', at: new Date().toISOString() }));
  await check('A13 a PR removing the dependencies passes check-pr and validate', () => {
    const sha = W.branchOf('chore-deps', (w) => writeIn(w, 'package.json', JSON.stringify({ dependencies: {} })));
    const r = W.checkPr('chore-deps', sha);
    assert.equal(r.status, 0, `A13 check-pr passes\n${r.text}`);
    assert.doesNotMatch(r.text, /exterior\.md/, 'A13 check-pr: no exterior.md line');
    const v = W.runIn(path.join(W.old, '.worktrees', 'chore-deps'), ['validate']);
    assert.equal(v.status, 0, `A13 validate passes on the branch\n${v.text}`);
    assert.doesNotMatch(v.out, /exterior\.md/, 'A13 validate: no exterior.md line');
    W.onMain({ 'package.json': JSON.stringify({ dependencies: {} }) }, 'the dependencies removed');
  });
  await check('A13 on main: one drift per name, keyed by the name in lower case', () => {
    const f = W.findings('exterior-drift');
    assert.deepEqual(f.map((x) => [x.key, x.severity, x.subject]).sort(), [['lodash', 'low', 'exterior'], ['moment', 'low', 'exterior']], `A13 two drifts\n${JSON.stringify(f)}`);
    for (const x of f) assert.match(x.suggestion, /draft a new version of exterior\.md/, 'A13 the suggestion says draft a new version');
  });
  await check('A13 observe-metrics logs each once', () => {
    W.ok(['observe-metrics']);
    const obs = () => logLines(W).filter((o) => o.type === 'observation' && o.kind === 'exterior-drift');
    const first = obs();
    assert.equal(first.length, 2, `A13 two observations\n${JSON.stringify(first)}`);
    assert.equal(new Set(first.map((o) => o.source_key)).size, 2, 'A13 with distinct source_keys');
    W.ok(['observe-metrics']);
    assert.equal(obs().length, 2, 'A13 a second run logs none');
  });
  await check('A13 a private repo, as last recorded, raises no drift', () => {
    write(path.join(W.old, 'docs/devteam/run/repo-visibility.json'), JSON.stringify({ visibility: 'private', at: new Date().toISOString() }));
    assert.equal(W.findings('exterior-drift').length, 0, 'A13 private: no drift');
  });
}));

test('A14 A15 exterior-stale and exterior-missing', withProject('exterior-stale', { exterior: PLAIN_EXT }, async (W, check) => {
  await check('A14 the plain fixture as it stands raises nothing (its base: the last commit changing it on main)', () => {
    assert.deepEqual(exteriorFindings(W), [], 'A14 no exterior finding');
  });
  let first = null;
  await check('A14 main\'s strategy moved on: exterior-stale', () => {
    W.onMain({ [STRAT]: `${STRATEGY}- It ships twice a year.\n` }, 'strategy moves on');
    const f = W.findings('exterior-stale');
    assert.equal(f.length, 1, `A14 one stale\n${JSON.stringify(f)}`);
    assert.match(f[0].suggestion, /re-read self\.md first/, 'A14 says re-read self.md first');
    assert.deepEqual([f[0].severity, f[0].subject, f[0].key], ['low', 'exterior', `${W.blob(STRAT)}-${W.blob(SELF)}`], 'A14 low, keyed by both blobs');
    first = f[0].key;
  });
  await check('A14 self.md moved on instead: exterior-stale with another key', () => {
    W.onMain({ [STRAT]: STRATEGY, [SELF]: `${SELF_MD}\nIt also keeps a changelog.\n` }, 'self.md moves on');
    const f = W.findings('exterior-stale');
    assert.equal(f.length, 1, `A14 one stale\n${JSON.stringify(f)}`);
    assert.notEqual(f[0].key, first, 'A14 a different key');
  });
  await check('A15 self.md and a linking strategy but no exterior.md: exterior-missing', () => {
    W.onMain({ [EXT]: null }, 'no exterior.md');
    const f = W.findings('exterior-missing');
    assert.equal(f.length, 1, `A15 one missing\n${JSON.stringify(f)}`);
    assert.match(f[0].suggestion, /draft exterior\.md/, 'A15 says draft exterior.md');
    assert.deepEqual([f[0].severity, f[0].subject, f[0].key], ['high', 'exterior', `${W.blob(STRAT)}-${W.blob(SELF)}`], 'A15 high (kit-814 K1), keyed by both blobs');
  });
  await check('A15 an unlinked strategy, or no self.md: none', () => {
    W.onMain({ [STRAT]: STRATEGY.replace(/^What Quillmark is.*\n\n/m, '') }, 'strategy unlinks self.md');
    assert.equal(W.findings('exterior-missing').length, 0, 'A15 unlinked: none');
    W.onMain({ [STRAT]: STRATEGY, [SELF]: null }, 'no self.md');
    assert.equal(W.findings('exterior-missing').length, 0, 'A15 no self.md: none');
  });
}));

// supervisor.md's Monitoring and Outside senses (kit-865): the world-model paragraphs and the section
const SUPMD = fs.readFileSync(new URL('../docs/devteam/process/supervisor.md', import.meta.url), 'utf8');
const MON = /\n### Monitoring\n([\s\S]*?)(?=\n#{2,3} )/.exec(SUPMD)?.[1] ?? '';
const OUTSIDE = /\n## Outside senses\n([\s\S]*?)(?=\n## )/.exec(SUPMD)?.[1] ?? '';
const monPara = (head) => new RegExp(`\\*\\*${re(head)}\\*\\*\\n([\\s\\S]*?)(?=\\n\\n|$)`).exec(MON)?.[1] ?? '';
const bullet = (text, head) => text.split('\n').find((l) => l.startsWith(`- **${head}`)) ?? '';

test('A17 Monitoring documents drafting exterior.md', () => {
  const para = monPara('Drafting exterior.md.');
  assert.ok(para, 'A17 Monitoring has a paragraph headed Drafting exterior.md');
  for (const want of [
    /after .*self\.md.* is on main/, /from dated research/, /serves, depends on, builds on it, alternative, collaborates, governs it, affects/, /business roles.*only examples/i,
    /never a private person/, /what matters/, /signals that would show it, in words/, /Order is importance/, /names rule/,
    /exterior-drift/, /exterior-stale.*re-read `?self\.md`? first/, /exterior-missing/,
  ]) assert.match(para, want, `A17 the paragraph says ${want}`);
  assert.match(para, /`exterior-missing` \([^)]*high until the owner has[^)]*medium while its question is open\)/, 'K9 the exterior-missing line says its severity (kit-814)');
  const c = para.indexOf('exterior check');
  assert.ok(c >= 0 && c < para.indexOf('chore pr'), 'A17 exterior check comes before chore pr');
});

test('kit-865 Monitoring and Outside senses: how the Self and the Exterior are kept right', async (t) => {
  const draft = monPara('Drafting exterior.md.'), keep = monPara('Keeping the Self and the Exterior right.');
  const has = (id, text, wants) => t.test(id, () => { for (const w of wants) assert.match(text, w, `${id} says ${w}`); });
  // DW1: Keeping it right
  await has('KR1 who researches, and the second reader on each page', bullet(draft, 'Who researches'), [/researcher[^.]*strong model/, /second reader, not the researcher, opens each page the draft relies on/, /search result or a summary is not used/]);
  await t.test('KR2 one weekly recurring chore over both documents, with its entry to ask for', () => {
    const line = bullet(keep, 'One weekly pass');
    assert.match(line, /one `recurring-edit`[^.]*a chore of yours over both, weekly/, 'KR2 one recurring-edit for one chore over both, weekly');
    const change = /--change '(\{[^']*\})'/.exec(line)?.[1];
    assert.ok(change, `KR2 the line gives the --change to ask\n${line}`);
    const job = JSON.parse(change).recurring?.['world-pass'];
    assert.deepEqual([job?.kind, job?.by, job?.every, job?.on, job?.grace_days], ['chore', 'supervisor', '1w', 'mon', 1], 'KR2 a chore of yours, every week on Mondays, a day of grace');
    assert.match(line, /Self first, then the Exterior/, 'KR2 the Self first');
  });
  await has('KR3 what a pass re-reads', bullet(keep, 'What a pass re-reads'), [/Every page the Exterior cites under what to watch, its rivals and its vendors/, /at least once in four passes/, /what merged since the approved `self\.md`'s commit/]);
  await has('KR4 dated notes', bullet(keep, 'Dated notes'), [/page's own date if it has one, and the day it was read/, /not bumped for their own sake/]);
  await has('KR5 a fast sense, exterior-stale or the owner\'s word starts a pass sooner, as an ordinary chore', bullet(keep, 'Sooner'), [/fast sense/, /`exterior-stale`/, /a move the owner mentions/, /starts a pass at once, as an ordinary chore/, /moves no slot/, /unless a pass's note already says why nothing had to change/, /nothing to land ends with `chore drop <slug>/]);
  await has('KR6 where notes and ideas are kept, on a private and a public repo; public notes in the main checkout\'s run/', keep, [/known to be private, notes go under `project\/senses\/`/, /On any other they go to the main checkout's `run\/`, untracked, never the chore worktree's/, /notes stay in `run\/`, you show the owner what to take through a preview of that file/, /you stop \(`preview stop <name>`\) once the owner has read it/]);
  await has('KR7 how a finding is taken up or passed', bullet(keep, 'A finding becomes an idea'), [/take each finding up \(a lesson, a ticket inside a running goal, a new goal drafted\) or pass on it with one line of why/, /No finding starts work by itself/]);
  await has('KR8 which pages a pass may read, and the recurring-edit question says so', bullet(keep, 'What a pass may read'), [/question says that the job reads the public pages the approved Exterior cites/, /read every week only once an approved Exterior cites it/, /signed out/, /the recurring-edit yes stands in for the page-list question/]);
  // DW2: what starts a new Self
  await has('KR9 what starts a new Self, and its source', bullet(keep, 'What starts a new Self'), [/`self-drift`/, /an approved strategy change/, /in the weekly pass, a reading of what merged since the approved `self\.md`'s commit/, /source is the commit or PR/]);
  // DW3: proposing a change
  const prop = bullet(keep, 'Proposing a change');
  await has('KR10 only when something changed, one question per document from the draft\'s own chore', prop, [/Only when something changed/, /chore of its own \(`chore start self`, `chore start exterior`\)/, /one question per document[^.]*never one per passage/]);
  await has('KR11 a line per changed passage on the card', prop, [/one short line per changed passage, most important first: what changes, why, and the source/, /when even those lines would make the card long, it says how many more the change note holds/]);
  await has('KR12 a linked change note on the draft\'s branch, each passage whole', prop, [/change note is a markdown file[^.]*on the draft's own branch/, /the card links it: each passage whole, with the old words, the new words, why, and the source with the day it was read/]);
  await has('KR13 at most one open per document, withdrawn and asked again', bullet(keep, 'One open per document'), [/At most one open question per document/, /withdraw it[^.]*and ask once with everything/]);
  await has('KR14 what follows an alteration or a No; a refused passage', bullet(keep, 'The owner\'s answer'), [/An alteration: amend the draft[^.]*ask about the new text/, /A No: drop the draft's chore[^.]*main's version stands/, /refused is proposed again only when its source changed/]);
  await has('KR15 exterior-stale with nothing to change stays raised, its reason in the note', bullet(keep, 'One open per document'), [/leave `exterior-stale` raised until the next version, and say in the pass's note why nothing had to change/]);
  // DW4: the document's order, and nothing of the block
  await has('KR16 senses are asked in the document\'s order', OUTSIDE, [/Ask in the document's own order/, /the earliest in `exterior\.md`'s order first/]);
  for (const [id, where, text] of [['KR17a', 'Drafting exterior.md', draft], ['KR17b', 'Keeping the Self and the Exterior right', keep], ['KR17c', 'Outside senses', OUTSIDE]]) {
    await t.test(`${id} ${where} holds no line on weights, scores, blobs or strategy quotes`, () => {
      assert.ok(text, `${id} ${where} is there`);
      const bad = text.split('\n').filter((l) => /\bweigh|\bweights?\b|\bscores?\b|blob|strategy quote/i.test(l));
      assert.deepEqual(bad, [], `${id} ${where} holds no line on weights, scores, blobs or strategy quotes`);
    });
  }
  // DW5: names in public
  const names = bullet(draft, 'Names in public, by the owner\'s word');
  await has('KR18 a name in public: asked once, quoting none; the owner\'s own words, then a strategy-change', names, [/ask once which other companies or products it may name/, /quotes no name and recommends none/, /answer itself is in the public log/, /in their own words\. Then propose a `strategy-change` holding just those names/]);
  await has('KR19 what a name in public never covers', bullet(draft, 'What a name in public covers'), [/Never a private person, anything known only privately, or the project's weak points, plans and ideas/]);
  await has('KR23 a heading is refused unless its words are named: levels 3 to 6 whole, # and ## by every capitalised word, in any form; --names-checked never clears one (d-20261126-020531504)', bullet(draft, 'The names rule'), [/a heading of level 3 to 6 must be named whole, and in a `#` or `##` heading every capitalised word but Exterior must be named/, /in any form \(`#` marks, an underline or an HTML heading, in a list item or a quote too\)/, /`--names-checked` never clears a heading: only rewording, or the strategy naming it through the owner's names question, clears it/, /`--names-checked` is only for a word the rule allows: never for an organisation or work main's strategy or dependency files don't name/]);
  await has('KR20 how a name is taken back', bullet(draft, 'Taking a name back'), [/stop using it at once and propose the strategy without it in any line/, /a heading naming it is refused and any other use is held: never clear it with `--names-checked`/, /raises `exterior-drift`/]);
  // the private and the public side of a finding, and what a public repo keeps out of everything tracked, logged or pushed
  await has('KR21 on a private repo a finding is an observation naming its source', bullet(keep, 'A finding becomes an idea'), [/On a repo known to be private, each finding is an observation naming its source/, /On any other, none is/]);
  await has('KR22 a public repo keeps names and weak points out of everything tracked, logged or pushed', bullet(keep, 'What a public repo keeps out'), [/nothing you track, log or push names what the names rule doesn't allow or states a weak point of the project: no/, /no observation, goal, lesson, ticket or message, no question's card line, no change note's why, no `recurring done` or `chore drop` reason/, /names only in `self\.md` and `exterior\.md`[^.]*your care/]);

});

// the weekly job's entry, as Keeping the Self and the Exterior right gives it, is one validate accepts
test('kit-865 KR2b the world-pass entry passes validate', withProject('exterior-world-pass', {}, async (W, check) => {
  await check('KR2b recurring.json holding just the entry: validate says nothing of it', () => {
    const line = bullet(monPara('Keeping the Self and the Exterior right.'), 'One weekly pass');
    const change = /--change '(\{[^']*\})'/.exec(line)?.[1];
    assert.ok(change, `KR2b the line gives the --change to ask\n${line}`);
    W.writeTree(`${P}/recurring.json`, `${JSON.stringify(JSON.parse(change).recurring, null, 2)}\n`);
    const v = W.run(['validate']);
    assert.doesNotMatch(v.out, /recurring/i, `KR2b validate finds nothing wrong with the entry\n${v.out}`);
    assert.equal(v.status, 0, `KR2b validate passes\n${v.text}`);
  });
}));

// final-1 F1: a name in a fenced block is read; F2: a version added then deleted is still read
const SECRET = `${PLAIN_EXT}\n\`\`\`text\nZentrix Labs is our secret client.\n\`\`\`\n`;
test('final-1 F1 F2 every fenced block and every version are read', withProject('exterior-final1', { strategy: STRATEGY_PLAIN, visibility: 'public' }, async (W, check) => {
  await check('F1 a word in another fenced block is held by exterior check, chore pr and check-pr', () => {
    W.writeTree(EXT, SECRET);
    const x = W.run(['exterior', 'check']);
    assert.match(x.out, /^warn: exterior\.md: "Zentrix" \(word\)/m, `F1 exterior check warns of the word in a text block\n${x.text}`);
    W.writeTree(EXT, null);
    const p = W.chorePr('fence', (w) => writeIn(w, EXT, SECRET));
    assert.equal(p.status, 1, `F1 chore pr refuses\n${p.text}`);
    assert.equal(p.pushed(), false, 'F1 nothing pushed');
    const sha = W.branchOf('chore-fence2', (w) => writeIn(w, EXT, SECRET));
    const k = W.checkPr('chore-fence2', sha);
    assert.equal(k.status, 1, `F1 check-pr fails\n${k.text}`);
    assert.match(k.text, /^fail: .*names "Zentrix" \(word\)/m, 'F1 check-pr names the word');
  });
  await check('F2 an exterior.md added then deleted on a branch, main having none, is still held', () => {
    const added = W.branchOf('chore-ad', (w) => writeIn(w, EXT, ZENTRIX));
    const w = path.join(W.old, '.worktrees', 'chore-ad');
    fs.rmSync(path.join(w, EXT));
    const tip = commitIn(W, w, 'deleted again');
    W.g(['push', '-q', 'origin', 'chore-ad'], w);
    const k = W.checkPr('chore-ad', tip);
    assert.equal(k.status, 1, `F2 check-pr fails\n${k.text}`);
    assert.match(k.text, /"Zentrix Labs" \(a ### heading\) is not named whole/, 'F2 check-pr names it');
    assert.ok(k.text.includes(added.slice(0, 12)), `F2 naming the commit ${added.slice(0, 12)}`);
    const m = W.run(['merge', '--chore', 'ad', '--dry-run']);
    assert.notEqual(m.status, 0, `F2 merge --chore refuses\n${m.text}`);
  });
}));

// final-1b F3: a version 1 draft, whatever its quotes and blobs, is refused at every gate by its block
// (exterior@2 has none); the quote and blob rules themselves are A6 and A7's validate halves
test('final-1b F3 check-pr, merge --chore and chore pr refuse a version 1 draft at the head', withProject('exterior-final1b', { exterior: EXTERIOR_MD, visibility: 'public' }, async (W, check) => {
  const staleSelf = extBlock((v) => { v.self_blob = 'c69d5ece56a6aa7dd72e1257f0eac0892e0c73c1'; }, REWORDED_V1);
  const badQuote = extBlock((v) => { v.entities[1].strategy[0] = 'Sync runs on Acme Storage, so it must stay fast and cheaq.'; }, REWORDED_V1);
  const words = /holds a fenced exterior block at line \d+: a plain document has none/;
  for (const [slug, text] of [['stale', staleSelf], ['quote', badQuote]]) {
    await check(`F3 ${slug}: refused at check-pr, merge --chore and chore pr`, () => {
      const sha = W.branchOf(`chore-${slug}`, (w) => writeIn(w, EXT, text));
      const k = W.checkPr(`chore-${slug}`, sha);
      assert.equal(k.status, 1, `F3 ${slug}: check-pr fails\n${k.text}`);
      assert.match(k.text, new RegExp(`^fail: .*breaks exterior@2 at [0-9a-f]{12}: .*${words.source}`, 'm'), `F3 ${slug}: check-pr says why`);
      const m = W.run(['merge', '--chore', slug, '--dry-run']);
      assert.notEqual(m.status, 0, `F3 ${slug}: merge --chore refuses\n${m.text}`);
      assert.match(m.text, words, `F3 ${slug}: merge --chore says why`);
      const p = W.chorePr(`${slug}-c`, (w) => writeIn(w, EXT, text));
      assert.equal(p.status, 1, `F3 ${slug}: chore pr refuses\n${p.text}`);
      assert.match(p.text, words, `F3 ${slug}: chore pr says why`);
      assert.equal(p.pushed(), false, `F3 ${slug}: nothing pushed`);
    });
  }
}));
