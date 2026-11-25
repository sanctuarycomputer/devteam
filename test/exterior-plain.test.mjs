// kit-863: exterior.md is a plain document (exterior@2). P1, P1t: the self-plain region, run alone in
// vm, gives every world2 exterior case its cases.json result, word for word the reference's, in linear
// time. P2: exterior check gives each case the reference's result. N: the names rule, free on a private
// repo, over every pushed version on any other, against origin main's files. S: exterior-stale from
// git. D: exterior-drift from headings. M: version 1 on main and as a draft. V: show and data. P5: one
// judgment. H: the help line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { json, write } from './lib/kit.mjs';
import { fixture, SUP } from './lib/next-step-fixture.mjs';
import { checkExterior as refCheckExterior } from './fixtures/world2/check.mjs';

const P = 'docs/devteam/project';
const SELF = `${P}/self.md`;
const STRAT = `${P}/strategy.md`;
const EXT = `${P}/exterior.md`;
const SRC = fs.readFileSync(new URL('../docs/devteam/scripts/devteam.mjs', import.meta.url), 'utf8');
const world = (f) => fs.readFileSync(new URL(`./fixtures/world/${f}`, import.meta.url), 'utf8');
const world2 = (f) => fs.readFileSync(new URL(`./fixtures/world2/${f}`, import.meta.url), 'utf8');
const W2 = JSON.parse(world2('cases.json'));
const PKG = JSON.stringify(W2.package);
const PARTS = Object.fromEntries(W2.paths.map((p) => [`docs/devteam/${p.slice('docs/'.length)}`, 'x\n']));
const EXTERIOR = world2('exterior.md');
// a rival the strategy doesn't name, with its page: free on a private repo, held on any other
const ZORBLY = `${EXTERIOR.replace('## Vendors', '### Zorbly\n\nIt syncs notes too. [Its page](https://zorbly.example/plans) says how (read 2026-11-20).\n\n## Vendors')}`;
const CASES = W2.cases.filter((c) => c.doc === 'exterior');
const allowed = { names: `${world2('strategy.md')}\n${Object.keys(W2.package.dependencies).join('\n')}`, words: `${world2('strategy.md')}\n${PKG}` };
const region = () => SRC.match(/\/\* self-plain start \*\/([\s\S]*?)\/\* self-plain end \*\//)?.[1] ?? '';
const plainOf = () => vm.runInContext(`${region()}\n;(typeof selfPlain === 'object' ? selfPlain : {})`, vm.createContext({ path, URL }));
const copy = (x) => JSON.parse(JSON.stringify(x));
// today, and each real date of a text moved by as many days as today is past cases.json's
const TODAY = new Date().toISOString().slice(0, 10);
const DAY = 86400000;
const SHIFT = Math.round((Date.parse(`${TODAY}T00:00:00Z`) - Date.parse(`${W2.today}T00:00:00Z`)) / DAY);
const realDay = (d) => { const t = new Date(`${d}T00:00:00Z`); return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d; };
const shifted = (text) => text.replace(/(?<!\d)\d{4}-\d{2}-\d{2}(?!\d)/g, (d) => (realDay(d) ? new Date(Date.parse(`${d}T00:00:00Z`) + SHIFT * DAY).toISOString().slice(0, 10) : d));
// what the reference says of a case, as the fixture reads it
const oracle = (c) => refCheckExterior(shifted(world2(c.file)), { today: TODAY, visibility: c.visibility, allowed });

function proj(name, { strategy = world2('strategy.md'), self = world2('self.md'), exterior = null, files = PARTS, visibility = 'public' } = {}) {
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
  const run = (args, cwd = old, env = ENV) => { const r = F.run(cwd, args, env); return { status: r.status, out: r.out, err: r.err, text: `${r.out}\n${r.err}` }; };
  const ok = (args, cwd = old) => { const r = run(args, cwd); assert.equal(r.status, 0, `${args.join(' ')}\n${r.text}`); return r.out; };
  const onMain = (changes, msg = 'main') => {
    for (const [rel, text] of Object.entries(changes)) {
      if (text === null) fs.rmSync(path.join(old, rel), { recursive: true, force: true });
      else write(path.join(old, rel), text);
    }
    g(['add', '-A'], old);
    g(['commit', '-qm', msg, '--allow-empty'], old);
    g(['push', '-q', 'origin', 'main'], old);
    return g(['rev-parse', 'HEAD'], old);
  };
  onMain({ [STRAT]: strategy, ...(self === null ? {} : { [SELF]: self }), ...(exterior === null ? {} : { [EXT]: exterior }), 'package.json': PKG, ...files }, 'fixture');
  const blob = (rel) => g(['rev-parse', `origin/main:${rel}`], old);
  const wts = new Map();
  // a chore branch off main, its files changed by change(w), committed and pushed; its head
  const commitOn = (slug, change, msg = slug) => {
    const w = path.join(old, '.worktrees', `chore-${slug}`);
    if (!wts.has(slug)) { g(['worktree', 'add', '-q', '-b', `chore-${slug}`, w, 'origin/main'], old); wts.set(slug, w); }
    change(w);
    g(['add', '-A'], w);
    g(['commit', '-qm', msg, '--allow-empty'], w);
    g(['push', '-qf', 'origin', `chore-${slug}`], w);
    write(path.join(old, `docs/devteam/run/pr/chore-${slug}.md`), `# chore-${slug}: x\n\n## One-way doors\n\nNone.\n`);
    return g(['rev-parse', 'HEAD'], w);
  };
  const wtOf = (slug) => path.join(old, '.worktrees', `chore-${slug}`);
  // chore pr on a chore whose worktree change(w) edits (chore start first when new)
  const chorePr = (slug, change, more = []) => {
    const w = wtOf(slug);
    if (!fs.existsSync(w)) ok(['chore', 'start', slug]);
    change(w);
    const r = run(['chore', 'pr', slug, '--title', `${slug} draft`, ...more]);
    return { ...r, w, pushed: () => g(['ls-remote', 'origin', `refs/heads/chore-${slug}`], old) !== '' };
  };
  const body = path.join(F.base, 'pr-body.md');
  write(body, 'x\n\n## One-way doors\n\nNone.\n');
  const checkPr = (headRef, sha) => run(['check-pr', '--head-ref', headRef, '--sha', sha, '--title', `${headRef}: x`, '--body-file', body]);
  // an exterior-change question pinning the draft on chore-<slug>, answered by the owner
  let n = 0;
  const askAbout = (slug, answer = 'yes') => {
    const q = ok(['ask', '--question', `Approve this exterior (${++n})?`, '--recommendation', 'yes', '--stake', '3', '--urgency', '2', '--new-because', 'the test asks again', '--class', 'exterior-change', '--reasons', 'owner-only', '--links', JSON.stringify([{ title: 'The exterior', path: EXT, ref: `chore-${slug}` }]), '--approves', `chore-${slug}`]).trim();
    F.ok(old, ['answer', q, answer]);
    return q;
  };
  // merge chore-<slug> into main as merge does (--no-ff), or squashed
  const land = (slug, { squash = false } = {}) => {
    g(['fetch', '-q', 'origin'], old);
    if (squash) { g(['merge', '-q', '--squash', `chore-${slug}`], old); g(['commit', '-qm', `chore-${slug} (squashed)`], old); }
    else g(['merge', '-q', '--no-ff', `chore-${slug}`, '-m', `merge chore-${slug}`], old);
    g(['push', '-q', 'origin', 'main'], old);
  };
  const findings = (kinds, cwd = old) => json(ok(['metrics', '--json'], cwd)).findings.filter((f) => kinds.includes(f.kind));
  const record = (v) => write(path.join(old, 'docs/devteam/run/repo-visibility.json'), JSON.stringify({ visibility: v, at: new Date().toISOString() }));
  const logLines = () => { const d = path.join(old, 'docs/devteam/run/log'); return fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.endsWith('.jsonl')).flatMap((f) => fs.readFileSync(path.join(d, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))) : []; };
  return { ...F, run, ok, onMain, blob, commitOn, wtOf, chorePr, checkPr, askAbout, land, findings, record, logLines, setVisibility, ENV };
}
const withProject = (name, opts, body) => async (t) => {
  const W = proj(name, opts);
  try { await body(W, (title, fn) => t.test(title, fn)); } finally { W.done(); }
};
const lines = (text, kind) => [...text.matchAll(new RegExp(`^${kind}: (.*)$`, 'gm'))].map((m) => m[1]);

test('P1 the region gives each world2 exterior case its result', () => {
  const P = plainOf();
  assert.equal(typeof P.checkExterior, 'function', 'P1 the self-plain region has checkExterior');
  assert.equal(CASES.length, 105, 'P1 105 exterior cases');
  for (const c of CASES) {
    const opts = { today: W2.today, visibility: c.visibility, allowed };
    const got = copy(P.checkExterior(world2(c.file), opts));
    for (const k of ['errors', 'warnings']) {
      assert.equal(got[k].length, c.expect[k].length, `P1 ${c.file} ${k}: ${JSON.stringify(got[k])}`);
      c.expect[k].forEach((w, i) => assert.ok(got[k][i].includes(w), `P1 ${c.file}: "${got[k][i]}" names "${w}"`));
    }
    for (const k of ['refused', 'held', 'hosts']) assert.deepEqual(got[k], c.expect[k], `P1 ${c.file} ${k}`);
    assert.deepEqual(got, refCheckExterior(world2(c.file), opts), `P1 ${c.file}: word for word the reference's`);
  }
  for (const f of ['exterior.md', 'exterior-topic.md']) for (const visibility of ['private', 'public', 'unknown']) {
    assert.deepEqual(copy(P.checkExterior(world2(f), { today: W2.today, visibility, allowed })), { errors: [], warnings: [], refused: [], held: [], hosts: [] }, `P1 ${f} ${visibility}`);
  }
});

// kit-862 final-2 F1, final-3 M1: the names hold is linear in links and words; each text under 2 s
test('P1t the region reads a hostile or large exterior text in under 2 s each', () => {
  const P = plainOf();
  assert.equal(typeof P.checkExterior, 'function', 'P1t the self-plain region has checkExterior');
  const name = (i) => `Z${i.toString(36).replace(/\d/g, (d) => 'abcdefghij'[d])}x`;
  const distinct = (n) => Array.from({ length: n }, (_, i) => name(i)).join(' ');
  for (const [what, x] of [
    ['20,000 distinct held words', distinct(20000)],
    ['40,000 nested [ then links', `${'['.repeat(40000)}${'[a](b) '.repeat(40000)}`],
    ['40,000 links to distinct hosts', Array.from({ length: 40000 }, (_, i) => `[a](https://h${i}.example/)`).join(' ')],
    ['5,000 ### entries, each dated', Array.from({ length: 5000 }, (_, i) => `### ${name(i)}\n\n[p](https://x.example/) (read 2026-11-20)\n`).join('\n')],
    ['a user of 100,000 commas', `[x](https://${'a,'.repeat(100000)}@b.example)`],
    ['www. 2,000 times', 'www.'.repeat(2000)],
  ]) {
    const start = process.hrtime.bigint();
    assert.doesNotThrow(() => P.checkExterior(`# T\n\n${x}\n`, { today: W2.today, visibility: 'public', allowed }), what);
    const s = Number(process.hrtime.bigint() - start) / 1e9;
    assert.ok(s < 2, `P1t ${what} took ${s.toFixed(2)} s`);
  }
});

test('P2 exterior check gives each world2 exterior case the reference\'s result', withProject('x-cases', {}, async (W, check) => {
  await check('P2 exterior check: errors and refused headings as errors, exit 1 only with one; dated sources, held words and hosts as warnings', () => {
    for (const c of CASES) {
      W.setVisibility(c.visibility);
      write(path.join(W.old, EXT), shifted(world2(c.file)));
      const o = oracle(c);
      const r = W.run(['exterior', 'check']);
      const errs = [...r.out.matchAll(/^error: exterior\.md: (.*)$/gm)].map((m) => m[1]);
      const warns = [...r.out.matchAll(/^warn: exterior\.md: (.*)$/gm)].map((m) => m[1]);
      assert.deepEqual(errs.slice(0, o.errors.length), o.errors, `P2 exterior check's errors on ${c.file}\n${r.out}`);
      assert.equal(errs.length, o.errors.length + o.refused.length, `P2 exterior check's error lines on ${c.file}\n${r.out}`);
      o.refused.forEach((n, i) => assert.ok(errs[o.errors.length + i].startsWith(`"${n}" (a ### heading)`), `P2 ${c.file} refuses "${n}"\n${r.out}`));
      assert.deepEqual(warns.slice(0, o.warnings.length), o.warnings, `P2 exterior check's warnings on ${c.file}\n${r.out}`);
      const held = [...o.held.map((w) => `"${w}" (word)`), ...o.hosts.map((h) => `"${h}" (link host)`)];
      assert.deepEqual(warns.slice(o.warnings.length).map((w) => w.replace(/ is in neither.*$/, '')), held, `P2 ${c.file} holds each word and host\n${r.out}`);
      assert.equal(r.status, o.errors.length + o.refused.length ? 1 : 0, `P2 exterior check's exit on ${c.file}\n${r.out}`);
    }
    fs.rmSync(path.join(W.old, EXT));
  });
}));

test('N the names rule: free on a private repo; on any other, over every pushed version, against origin main\'s files', withProject('x-names', {}, async (W, check) => {
  await check('N1 on a private repo a draft naming a rival the strategy doesn\'t passes exterior check and chore pr', () => {
    W.setVisibility('private');
    write(path.join(W.old, EXT), ZORBLY);
    const r = W.run(['exterior', 'check']);
    assert.equal(r.status, 0, `N1 exterior check passes\n${r.text}`);
    assert.doesNotMatch(r.out, /Zorbly|zorbly/, `N1 no name line\n${r.out}`);
    fs.rmSync(path.join(W.old, EXT));
    const p = W.chorePr('priv', (w) => write(path.join(w, EXT), ZORBLY));
    assert.equal(p.status, 0, `N1 chore pr pushes\n${p.text}`);
    assert.ok(p.pushed(), 'N1 pushed');
  });
  await check('N2 on a public repo the heading is refused and never cleared by naming it; on an unknown one too, saying so', () => {
    for (const v of ['public', 'unknown']) {
      W.setVisibility(v);
      write(path.join(W.old, EXT), ZORBLY);
      const r = W.run(['exterior', 'check']);
      assert.equal(r.status, 1, `N2 ${v}: exterior check exits 1\n${r.text}`);
      assert.match(r.out, /^error: exterior\.md: "Zorbly" \(a ### heading\) is not named whole in origin main's strategy\.md or its dependency names/m, `N2 ${v}: refused\n${r.out}`);
      fs.rmSync(path.join(W.old, EXT));
      const p = W.chorePr(`pub-${v}`, (w) => write(path.join(w, EXT), ZORBLY), ['--names-checked', 'Zorbly,zorbly.example']);
      assert.notEqual(p.status, 0, `N2 ${v}: chore pr refuses with the names checked\n${p.text}`);
      assert.match(p.text, /"Zorbly" \(a ### heading\)/, `N2 ${v}: names the heading\n${p.text}`);
      if (v === 'unknown') assert.match(p.text, /visibility is unknown/, 'N2 unknown: says so');
      assert.ok(!p.pushed(), `N2 ${v}: nothing pushed`);
    }
  });
  await check('N3 every pushed version: a heading and a word an earlier commit carries, gone at the head, still hold, naming the commit', () => {
    W.setVisibility('public');
    const w = W.wtOf('hist');
    W.ok(['chore', 'start', 'hist']);
    write(path.join(w, EXT), ZORBLY.replace('It syncs notes too.', 'It syncs notes too, as Brindle does.'));
    W.g(['add', '-A'], w);
    W.g(['commit', '-qm', 'hand'], w);
    const hand = W.g(['rev-parse', 'HEAD'], w).slice(0, 12);
    write(path.join(w, EXT), EXTERIOR);
    const p = W.run(['chore', 'pr', 'hist', '--title', 'hist']);
    assert.notEqual(p.status, 0, `N3 chore pr refuses\n${p.text}`);
    assert.match(p.text, new RegExp(`"Zorbly" \\(a ### heading\\)[^\\n]*commit ${hand} carries it`), `N3 the heading, in ${hand}\n${p.text}`);
    assert.match(p.text, new RegExp(`"Brindle" \\(word\\) in ${hand}`), `N3 the word, in ${hand}\n${p.text}`);
    assert.match(p.text, new RegExp(`"zorbly\\.example" \\(link host\\) in ${hand}`), `N3 the host, in ${hand}\n${p.text}`);
    const sha = W.commitOn('hist2', (x) => write(path.join(x, EXT), ZORBLY));
    const sha2 = W.commitOn('hist2', (x) => write(path.join(x, EXT), EXTERIOR));
    const c = W.checkPr('chore-hist2', sha2);
    assert.match(lines(c.out, 'fail').join('\n'), new RegExp(`"Zorbly" \\(a ### heading\\)[^\\n]*commit ${sha.slice(0, 12)} carries it`), `N3 check-pr fails the earlier version's heading\n${c.out}`);
    assert.match(lines(c.out, 'fail').join('\n'), /names "zorbly\.example" \(link host\) in /, `N3 check-pr fails its host\n${c.out}`);
  });
  await check('N4 the branch\'s own strategy allows nothing; origin main\'s does, a heading named whole', () => {
    W.setVisibility('public');
    const own = W.chorePr('own', (w) => { write(path.join(w, STRAT), `${world2('strategy.md')}\nZorbly is a rival.\n`); write(path.join(w, EXT), ZORBLY); });
    assert.notEqual(own.status, 0, `N4 the branch's strategy allows nothing\n${own.text}`);
    assert.match(own.text, /"Zorbly" \(a ### heading\)/, 'N4 refused');
    const sha = W.commitOn('own2', (w) => { write(path.join(w, STRAT), `${world2('strategy.md')}\nZorbly is a rival; its page is zorbly.example.\n`); write(path.join(w, EXT), ZORBLY); });
    assert.match(lines(W.checkPr('chore-own2', sha).out, 'fail').join('\n'), /"Zorbly" \(a ### heading\)/, 'N4 check-pr: the branch\'s strategy allows nothing');
    W.onMain({ [STRAT]: `${world2('strategy.md')}\nZorbly is a rival; its page is zorbly.example.\n` });
    write(path.join(W.old, EXT), ZORBLY);
    const r = W.run(['exterior', 'check']);
    assert.equal(r.status, 0, `N4 named on origin main: passes\n${r.text}`);
    assert.doesNotMatch(r.out, /Zorbly|zorbly/, `N4 no name line\n${r.out}`);
    fs.rmSync(path.join(W.old, EXT));
  });
}));

test('S exterior-stale from git: the latest approving answer\'s commit, else the last commit changing the file on main', withProject('x-stale', {}, async (W, check) => {
  const stale = () => W.findings(['exterior-stale']).map((f) => [f.severity, f.subject, f.key]);
  const pair = () => `${W.blob(STRAT)}-${W.blob(SELF)}`;
  let q1;
  await check('S1 an approved plain exterior.md, landed: not stale; once the strategy moves, one exterior-stale per pair', () => {
    W.commitOn('ext', (w) => write(path.join(w, EXT), EXTERIOR));
    q1 = W.askAbout('ext');
    W.land('ext');
    assert.deepEqual(stale(), [], 'S1 fresh');
    W.onMain({ [STRAT]: `${world2('strategy.md')}\nA new aim.\n` });
    assert.deepEqual(stale(), [['low', 'exterior', pair()]], 'S1 one stale, keyed by the pair');
    assert.match(W.findings(['exterior-stale'])[0].detail, /drew from a strategy\.md main has moved on from/, 'S1 its detail');
    W.ok(['observe-metrics']);
    W.ok(['observe-metrics']);
    assert.equal(W.logLines().filter((x) => x.type === 'observation' && x.kind === 'exterior-stale').length, 1, 'S1 one observation per pair');
  });
  await check('S2 the Self moving makes it stale too, under a new pair', () => {
    const before = pair();
    W.onMain({ [SELF]: world2('self.md').replace('# ', '# The ') });
    assert.deepEqual(stale(), [['low', 'exterior', pair()]], 'S2 one stale');
    assert.notEqual(pair(), before, 'S2 a new pair');
  });
  await check('S3 a refused question never counts; the latest approving one does', () => {
    W.commitOn('again', (w) => write(path.join(w, `${P}/designs/note.md`), 'n\n'));
    W.askAbout('again', 'no');
    assert.equal(stale().length, 1, 'S3 the refused one pinning main\'s text at today\'s strategy counts for nothing');
    W.askAbout('again', 'yes');
    assert.deepEqual(stale(), [], 'S3 the latest approving one, at today\'s strategy and Self: not stale');
  });
  await check('S4 a squash merge: the pinned commit holds while this clone has it; once its branch is deleted and gone, the squash commit is the base (a strategy change made while the draft waited is missed); one more change is seen', () => {
    W.commitOn('sq', (w) => write(path.join(w, EXT), EXTERIOR.replace('The most important come first.', 'The most important come first; the rest follow.')));
    const a = W.g(['rev-parse', 'chore-sq'], W.old);
    W.askAbout('sq');
    W.onMain({ [STRAT]: `${world2('strategy.md')}\nA newer aim.\n` });
    W.land('sq', { squash: true });
    assert.equal(stale().length, 1, 'S4 the pinned commit\'s strategy is not main\'s: stale');
    W.g(['worktree', 'remove', '--force', W.wtOf('sq')], W.old);
    W.g(['branch', '-D', 'chore-sq'], W.old);
    W.g(['push', '-q', 'origin', '--delete', 'chore-sq'], W.old);
    W.g(['update-ref', '-d', 'refs/remotes/origin/chore-sq'], W.old);
    fs.rmSync(path.join(W.old, '.git/ORIG_HEAD'), { force: true });
    W.g(['reflog', 'expire', '--expire=now', '--all'], W.old);
    W.g(['gc', '-q', '--prune=now'], W.old);
    assert.throws(() => W.g(['cat-file', '-e', `${a}^{commit}`], W.old), undefined, 'S4 the pinned commit is gone');
    assert.deepEqual(stale(), [], 'S4 falls back to the squash commit, whose strategy is main\'s: the change made while it waited is missed, as the design says');
    W.onMain({ [STRAT]: `${world2('strategy.md')}\nThe newest aim.\n` });
    assert.equal(stale().length, 1, 'S4 a change after the squash commit is seen');
  });
  await check('S5 a shallow clone whose boundary is the last commit changing the file: unknown, nothing raised, and exterior check says so', () => {
    W.onMain({ [EXT]: EXTERIOR.replace('The most important come first.', 'Most important first.') }, 'exterior, by hand');
    W.onMain({ [STRAT]: `${world2('strategy.md')}\nAn aim after it.\n` }, 'strategy after it');
    const clone = path.join(W.base, 'shallow');
    execFileSync('git', ['clone', '-q', '--depth', '2', `file://${W.org}`, clone]);
    const r = W.run(['metrics', '--json'], clone);
    assert.equal(r.status, 0, r.text);
    assert.deepEqual(json(r.out).findings.filter((f) => f.kind === 'exterior-stale'), [], 'S5 nothing raised');
    const c = W.run(['exterior', 'check'], clone);
    assert.match(c.out, /^warn: exterior\.md: whether main's exterior\.md is stale is unknown: the last commit changing it, [0-9a-f]{12}, is this shallow clone's boundary/m, `S5 exterior check says so\n${c.out}`);
  });
}));

test('D exterior-drift from headings, only where the repo was last known public', withProject('x-drift', { exterior: world2('exterior.md') }, async (W, check) => {
  const drift = () => W.findings(['exterior-drift']).map((f) => [f.key, f.severity, f.subject]);
  await check('D1 a heading main\'s strategy no longer names: one exterior-drift, keyed by it; a body word dropped raises none', () => {
    W.record('public');
    assert.deepEqual(drift(), [], 'D1 none while named');
    W.onMain({ [STRAT]: world2('strategy.md').replace('Notes stay plain text, where Ledgerpad locks them in. Its page is ledgerpad.example.', 'Notes stay plain text.').replace('It follows the Open Notes Format.', 'It follows an open format.') });
    assert.deepEqual(drift().sort(), [['ledgerpad', 'low', 'exterior'], ['open notes format', 'low', 'exterior']], 'D1 once per heading');
    W.ok(['observe-metrics']);
    W.ok(['observe-metrics']);
    assert.equal(W.logLines().filter((x) => x.type === 'observation' && x.kind === 'exterior-drift').length, 2, 'D1 one observation per name');
  });
  await check('D2 last known private, unknown, or no record: none', () => {
    for (const v of ['private', 'unknown']) { W.record(v); assert.deepEqual(drift(), [], `D2 ${v}`); }
    fs.rmSync(path.join(W.old, 'docs/devteam/run/repo-visibility.json'));
    assert.deepEqual(drift(), [], 'D2 no record');
  });
  await check('D3 a dependency name allows a heading', () => {
    W.record('public');
    W.onMain({ [EXT]: world2('exterior.md').replace('### Ledgerpad', '### inkwell-sync'), [STRAT]: world2('strategy.md') });
    assert.deepEqual(drift(), [], 'D3 none');
  });
}));

test('M version 1 on main, and a version 1 draft', withProject('x-v1', { strategy: world('strategy.md'), self: world('self.md'), exterior: world('exterior.md'), files: { 'app/main.js': 'a\n', 'app/plugins/api.js': 'a\n', 'sync/server.js': 's\n', 'deploy/sync.yml': 'd\n' } }, async (W, check) => {
  await check('M1 validate says nothing of a version 1 exterior.md on main', () => {
    const r = W.run(['validate']);
    assert.doesNotMatch(r.text, /exterior\.md/, `M1 validate\n${r.text}`);
  });
  await check('M2 one exterior-drift (exterior@1) and nothing else, even public with the strategy moved', () => {
    W.record('public');
    W.onMain({ [STRAT]: `${world('strategy.md')}\nA new aim.\n` });
    assert.deepEqual(W.findings(['exterior-drift', 'exterior-stale']).map((f) => [f.kind, f.key, f.severity]), [['exterior-drift', 'exterior@1', 'low']], 'M2 one drift');
    assert.match(W.findings(['exterior-drift'])[0].suggestion, /plain document/, 'M2 asks for the plain version');
  });
  await check('M3 a version 1 draft is refused by exterior check, chore pr and check-pr', () => {
    const draft = `${world('exterior.md')}\nOne more line.\n`;
    write(path.join(W.old, EXT), draft);
    const r = W.run(['exterior', 'check']);
    assert.equal(r.status, 1, `M3 exterior check\n${r.text}`);
    assert.match(r.out, /^error: exterior\.md: exterior\.md holds a fenced exterior block at line \d+: a plain document has none/m, `M3 exterior check names the block\n${r.out}`);
    W.g(['checkout', '--', EXT], W.old);
    const p = W.chorePr('v1', (w) => write(path.join(w, EXT), draft));
    assert.notEqual(p.status, 0, `M3 chore pr refuses\n${p.text}`);
    assert.match(p.text, /fenced exterior block/, `M3 chore pr names the block\n${p.text}`);
    const sha = W.commitOn('v1b', (w) => write(path.join(w, EXT), draft));
    assert.match(lines(W.checkPr('chore-v1b', sha).out, 'fail').join('\n'), /exterior\.md breaks exterior@2 at [0-9a-f]{12}: exterior\.md holds a fenced exterior block/, 'M3 check-pr fails it');
  });
  await check('M4 exterior show prints a version 1 document whole, exit 0', () => {
    const r = W.run(['exterior', 'show']);
    assert.equal(r.status, 0, r.text);
    assert.ok(r.out.includes(world('exterior.md').trimEnd()), `M4 the whole document\n${r.out}`);
  });
  await check('M5 a plain version landing on main clears the drift', () => {
    W.onMain({ [EXT]: world2('exterior.md') });
    W.record('private');
    assert.deepEqual(W.findings(['exterior-drift']), [], 'M5 none');
  });
}));

test('V exterior show, --json and dashboard-data for a plain file', withProject('x-show', { exterior: world2('exterior.md') }, async (W, check) => {
  await check('V1 exterior show prints main\'s plain document whole, exit 0', () => {
    const r = W.run(['exterior', 'show']);
    assert.equal(r.status, 0, r.text);
    assert.equal(r.out, `Exterior: ${EXT} on main\n\n${world2('exterior.md').trimEnd()}`, 'V1 the document');
  });
  await check('V2 exterior show --json and dashboard-data\'s exterior are null', () => {
    assert.equal(W.ok(['exterior', 'show', '--json']).trim(), 'null', 'V2 --json');
    assert.equal(json(W.ok(['dashboard-data'])).exterior, null, 'V2 dashboard-data');
  });
  await check('V3 validate passes a plain exterior.md on main and in the working tree', () => {
    write(path.join(W.old, EXT), `${world2('exterior.md')}\nAnother line.\n`);
    const r = W.run(['validate']);
    assert.doesNotMatch(r.text, /exterior\.md/, `V3 validate\n${r.text}`);
    W.g(['checkout', '--', EXT], W.old);
  });
}));

test('P5 one function judges a draft for exterior check, chore pr and check-pr', () => {
  assert.equal((SRC.match(/^function exteriorDraft\(/gm) ?? []).length, 1, 'P5 exteriorDraft is defined once');
  const body = (name) => SRC.slice(SRC.indexOf(`function ${name}(`), SRC.indexOf('\n}\n', SRC.indexOf(`function ${name}(`)));
  assert.match(body('exteriorVersionsScan'), /exteriorDraft\(/, 'P5 the versions scan (chore pr, check-pr) calls it');
  for (const f of ['exteriorChoreLines', 'exteriorDraftLines']) assert.match(body(f), /exteriorVersionsScan\(/, `P5 ${f} scans the versions`);
  assert.match(body('exteriorCheckLines'), /exteriorDraft\(/, 'P5 exterior check calls it');
});

test('H HELP_OBSERVE\'s exterior line says exterior@2 and the document', () => {
  const help = SRC.slice(SRC.indexOf('const HELP_OBSERVE')).split('\n').find((l) => l.includes('exterior show'));
  assert.doesNotMatch(help, /exterior@1|signals and scores/, `H no version 1 words: ${help}`);
  assert.match(help, /exterior@2/, `H names exterior@2: ${help}`);
});
