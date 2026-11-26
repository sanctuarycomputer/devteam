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
import { json, line, write } from './lib/kit.mjs';
import { fixture, SUP } from './lib/next-step-fixture.mjs';
import { checkExterior as refCheckExterior, headings as refHeadings } from './fixtures/world2/check.mjs';

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
// The wording a refused heading's line takes: "(a ### heading)" only where text heads an entry with
// it (a level-3 ATX heading), "(a heading)" for any other form or level (kit-933).
const formOf = (text, n) => (refHeadings(text).some((h) => h.level === 3 && h.text === n) ? '(a ### heading)' : '(a heading)');
// what the reference says of a case, as the fixture reads it
const oracle = (c) => refCheckExterior(shifted(world2(c.file)), { today: TODAY, visibility: c.visibility, allowed });

function proj(name, { strategy = world2('strategy.md'), self = world2('self.md'), exterior = null, files = PARTS, visibility = 'public' } = {}) {
  const F = fixture(name);
  const { old, g } = F;
  const bin = path.join(F.base, 'bin');
  const visFile = path.join(F.base, 'visibility');
  g(['config', `url.${F.org}.insteadOf`, 'https://github.com/acme/quillmark.git'], old);
  g(['remote', 'set-url', 'origin', 'https://github.com/acme/quillmark.git'], old);
  const ghLog = path.join(F.base, 'gh.log');
  write(path.join(bin, 'gh'), `#!/bin/sh\necho "$*" >> '${ghLog}'\ncase "$*" in *acme/quillmark*) ;; *) exit 1 ;; esac\nif [ "$1 $2" = "repo view" ] && [ -s '${visFile}' ]; then cat '${visFile}'; exit 0; fi\nexit 1\n`);
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
  // the gh calls asking the repo's visibility since the log was last cleared
  const visCalls = () => (fs.existsSync(ghLog) ? fs.readFileSync(ghLog, 'utf8').split('\n').filter((l) => l.startsWith('repo view')) : []);
  const clearGh = () => fs.rmSync(ghLog, { force: true });
  // a question line written by hand, as the supervisor's log holds one
  // the owner's answer (an owner command: the fixture's own, with no role)
  const answer = (q, a = 'yes') => F.ok(old, ['answer', q, a]);
  const supLine = (o) => fs.appendFileSync(path.join(old, 'docs/devteam/run/log', `supervisor-${new Date().toISOString().slice(0, 7)}.jsonl`), line({ at: new Date().toISOString(), by: 'supervisor', ...o }));
  return { ...F, run, ok, onMain, blob, commitOn, wtOf, chorePr, checkPr, askAbout, land, findings, record, logLines, setVisibility, visCalls, clearGh, supLine, answer, ENV };
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
    ['100,000 distinct held words', distinct(100000)],
    ['40,000 nested [ then links', `${'['.repeat(40000)}${'[a](b) '.repeat(40000)}`],
    ['40,000 links to distinct hosts', Array.from({ length: 40000 }, (_, i) => `[a](https://h${i}.example/)`).join(' ')],
    ['5,000 ### entries, each dated', Array.from({ length: 5000 }, (_, i) => `### ${name(i)}\n\n[p](https://x.example/) (read 2026-11-20)\n`).join('\n')],
    ['a user of 100,000 commas', `[x](https://${'a,'.repeat(100000)}@b.example)`],
    ['www. 2,000 times', 'www.'.repeat(2000)],
    // kit-933: every heading form, read in linear time
    ['50,000 setext headings', Array.from({ length: 50000 }, (_, i) => `${name(i)}\n---`).join('\n\n')],
    ['one paragraph of 50,000 lines over a setext line', `${distinct(50000).replace(/ /g, '\n')}\n===`],
    ['20,000 <h2 never closed, then 20,000 <h2>', `${'<h2 '.repeat(20000)}${'<h2>Z '.repeat(20000)}`],
    ['an <h2> holding 100,000 <', `<h2>${'<'.repeat(100000)}Z</h2>`],
    ['a list marker, 100,000 spaces, then a setext line', `- ${' '.repeat(100000)}x\n---`],
    ['50,000 quote and item markers before a ###', `${'> - '.repeat(50000)}### Z`],
    // finals 2 and 2b: a # or ## heading read as shown, its comments, instructions and quoted values whole
    ['an ## heading of 100,000 unclosed <!--', `## a${'<!--'.repeat(100000)}`],
    ['an ## heading of 100,000 unclosed <?', `## a${'<?'.repeat(100000)}`],
    ['an ## heading of 50,000 unclosed quoted values', `## a${'<b title="'.repeat(50000)}`],
    ['an ## heading of 50,000 quoted >', `## a${'<b title=">'.repeat(50000)}`],
    // finals 3 and 3b: the joined reading, each span read whole in linear time
    ['an ## heading of 30,000 quoted values holding a tag', `## a${'<b a="<b a="'.repeat(30000)}`],
    ['an ## heading of 50,000 unclosed declarations', `## a${'<!x '.repeat(50000)}`],
    ['an ## heading of 30,000 attribute names holding <', `## a${'<b a<b a '.repeat(30000)}`],
    ['an ## heading of 50,000 unclosed CDATA', `## a${'<![CDATA['.repeat(50000)}`],
    // finals 4 and 4b: the cut at each span's first >, and the brackets, in linear time
    ['an ## heading of 50,000 comments, none ended --!>', `## a${'<!-- -->'.repeat(50000)}`],
    ['an ## heading of 100,000 < then a letter, no >', `## a${'<x'.repeat(100000)}`],
    ['an ## heading of 50,000 unclosed comments', `## a${'<!--'.repeat(50000)}`],
    ['an ## heading of 50,000 ][', `## a${'[a]['.repeat(50000)}`],
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
      o.refused.forEach((n, i) => assert.ok(errs[o.errors.length + i].startsWith(`"${n}" ${formOf(shifted(world2(c.file)), n)} `), `P2 ${c.file} refuses "${n}" as ${formOf(shifted(world2(c.file)), n)}\n${r.out}`));
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
    const sha = W.commitOn('hist2', (x) => write(path.join(x, EXT), ZORBLY.replace('It syncs notes too.', 'It syncs notes too, as Brindle does.')));
    const sha2 = W.commitOn('hist2', (x) => write(path.join(x, EXT), EXTERIOR));
    const c = W.checkPr('chore-hist2', sha2);
    assert.match(lines(c.out, 'fail').join('\n'), new RegExp(`"Zorbly" \\(a ### heading\\)[^\\n]*commit ${sha.slice(0, 12)} carries it`), `N3 check-pr fails the earlier version's heading\n${c.out}`);
    assert.match(lines(c.out, 'fail').join('\n'), /names "zorbly\.example" \(link host\) in /, `N3 check-pr fails its host\n${c.out}`);
    assert.match(lines(c.out, 'fail').join('\n'), new RegExp(`names "Brindle" \\(word\\) in ${sha.slice(0, 12)}`), `N3 check-pr fails the earlier version's word, naming its commit\n${c.out}`);
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
  await check('N5 a draft holding nothing asks gh nothing, at exterior check, chore pr and check-pr, and leaves the visibility record as it was', () => {
    W.setVisibility('public');
    const rec = path.join(W.old, 'docs/devteam/run/repo-visibility.json');
    const before = fs.existsSync(rec) ? fs.readFileSync(rec, 'utf8') : null;
    W.clearGh();
    write(path.join(W.old, EXT), EXTERIOR);
    const r = W.run(['exterior', 'check']);
    assert.equal(r.status, 0, `N5 exterior check passes\n${r.text}`);
    fs.rmSync(path.join(W.old, EXT));
    const p = W.chorePr('clean', (w) => write(path.join(w, EXT), EXTERIOR.replace('The most important come first.', 'The most important come first, always.')));
    assert.equal(p.status, 0, `N5 chore pr pushes\n${p.text}`);
    const sha = W.commitOn('clean2', (x) => write(path.join(x, EXT), EXTERIOR.replace('The most important come first.', 'The most important come first; the rest follow.')));
    const c = W.checkPr('chore-clean2', sha);
    assert.doesNotMatch(c.out, /exterior\.md (breaks|names)|\(a ### heading\)/, `N5 check-pr has no exterior line\n${c.out}`);
    assert.deepEqual(W.visCalls(), [], 'N5 no gh repo view');
    assert.equal(fs.existsSync(rec) ? fs.readFileSync(rec, 'utf8') : null, before, 'N5 the visibility record unchanged');
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
  await check('S3b an approved draft that never landed is no base: its pinned blob is not main\'s', () => {
    W.onMain({ [STRAT]: `${world2('strategy.md')}\nA moved aim.\n` });
    assert.equal(stale().length, 1, 'S3b stale once the strategy moves');
    W.commitOn('later', (w) => write(path.join(w, EXT), EXTERIOR.replace('The most important come first.', 'The most important first, at the moved aim.')));
    W.askAbout('later');
    assert.equal(stale().length, 1, 'S3b the later approval, of a draft main lacks, drawn at today\'s strategy, counts for nothing');
  });
  await check('S3c a pin whose ref is not a full sha counts for nothing', () => {
    const head = W.g(['rev-parse', 'origin/main'], W.old);
    const q = 'q-20260105-000000001-supervisor';
    W.supLine({ id: q, type: 'question', op: 'new', kind: 'owner-decision', class: 'exterior-change', reasons: ['owner-only'], question: 'Approve this exterior (by hand)?', recommendation: 'yes', approves: ['chore-later'], links: [{ title: 'The exterior', path: EXT, ref: head.slice(0, 12), blob: W.blob(EXT) }] });
    W.answer(q);
    assert.equal(stale().length, 1, 'S3c main\'s own commit, named by 12 digits, is no base');
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
  await check('M3b a block the version 1 reader can\'t see (~~~, or in a list item) gets the block error from validate', () => {
    for (const [what, block] of [['~~~', '~~~exterior\n{ "exterior": 1 }\n~~~\n'], ['in a list item', '- An item.\n\n  ```exterior\n  { "exterior": 1 }\n  ```\n']]) {
      write(path.join(W.old, EXT), `${world2('exterior.md')}\n${block}`);
      const v = W.run(['validate']);
      assert.match(v.out, /exterior\.md: exterior\.md holds a fenced exterior block at line \d+: a plain document has none/, `M3b ${what}: validate\n${v.text}`);
    }
    W.g(['checkout', '--', EXT], W.old);
  });
  await check('M4 exterior show prints a version 1 document whole, exit 0', () => {
    write(path.join(W.old, EXT), world2('exterior.md'));
    const r = W.run(['exterior', 'show']);
    assert.equal(r.status, 0, r.text);
    assert.equal(r.out, `Exterior: ${EXT} on main\n\n${world('exterior.md').trimEnd()}`, `M4 the whole document, main's (the working tree holds a plain draft)\n${r.out}`);
    W.g(['checkout', '--', EXT], W.old);
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
    write(path.join(W.old, EXT), `${world2('exterior.md')}\nA draft line main lacks.\n`);
    assert.equal(W.ok(['exterior', 'show']), `Exterior: ${EXT} on main\n\n${world2('exterior.md').trimEnd()}`, 'V1 main\'s, not the working tree\'s draft');
    W.g(['checkout', '--', EXT], W.old);
  });
  await check('V2 exterior show --json and dashboard-data\'s exterior are null', () => {
    assert.equal(W.ok(['exterior', 'show', '--json']).trim(), 'null', 'V2 --json');
    assert.equal(json(W.ok(['dashboard-data'])).exterior, null, 'V2 dashboard-data');
    write(path.join(W.old, EXT), world('exterior.md'));
    assert.equal(W.ok(['exterior', 'show', '--json']).trim(), 'null', 'V2 --json reads main\'s plain file, not a version 1 draft in the working tree');
    W.g(['checkout', '--', EXT], W.old);
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

// kit-933: every heading a page shows is judged on a repo not known to be private. Level 3 to 6, in
// any form, is refused unless named whole; a # or ## heading (the title and sections, in plain words)
// is refused when it holds a capitalised word, Exterior aside, not named whole; both in origin main's
// strategy or dependency names. The reference and the region agree on each.
const formDoc = (x) => `# Exterior\n\n## Rivals\n\n${x}\n`;
const HEADING_FORMS = [
  ['an ## heading', '## Zorbly Labs', ['Zorbly Labs']],
  ['a second # heading', '# Zorbly', ['Zorbly']],
  ['a #### heading', '#### Zorbly', ['Zorbly']],
  ['a ###### heading, closing #s', '###### Zorbly ###', ['Zorbly']],
  ['a setext = heading', 'Zorbly\n======', ['Zorbly']],
  ['a setext - heading of two lines', 'Zorbly\nLabs\n---', ['Zorbly Labs']],
  ['an HTML <h2>, with an attribute', '<h2 class="x">Zorbly</h2>', ['Zorbly']],
  ['an HTML <h3>, a tag inside', '<h3><em>Zorbly</em></h3>', ['Zorbly']],
  ['an HTML <h6> never closed', '<h6>Zorbly', ['Zorbly']],
  ['an HTML <H1> in capitals', '<H1>Zorbly</H1>', ['Zorbly']],
  ['a ### in a list item', '- ### Zorbly', ['Zorbly']],
  ['an ## in an ordered item', '1. ## Zorbly', ['Zorbly']],
  ['a ### in a block quote', '> ### Zorbly', ['Zorbly']],
  ['a #### in a list in a block quote', '> - #### Zorbly', ['Zorbly']],
  ['a setext heading in a list item', '- Zorbly\n  ---', ['Zorbly']],
  ['a setext heading in a block quote', '> Zorbly\n> ===', ['Zorbly']],
  ['a lower-case ####', '#### zorbly co', ['zorbly co']],
  ['a lower-case ### in a block quote', '> ### zorbly', ['zorbly']],
  ['a lower-case <h4>', '<h4>zorbly</h4>', ['zorbly']],
  ['a setext heading of two quoted lines', '> Zorbly\n> Vendors\n> ---', ['Zorbly Vendors']],
  ['a setext heading of two lines in a list item', '- Zorbly\n  Labs\n  ---', ['Zorbly Labs']],
  ['an <h2> in a fence', '```\n<h2>Zorbly</h2>\n```', ['Zorbly']],
  ['an <h2> in a comment', '<!--\n<h2>Zorbly</h2>\n-->', ['Zorbly']],
  ['an <h2> after a comment on its line', '<!-- x --> <h2>Zorbly</h2>', ['Zorbly']],
  ['an <h2> in a code span', 'See `<h2>Zorbly</h2>` here.', ['Zorbly']],
  ['an <h2> between fence lines in a <div>', '<div>\n```\n<h2>Zorbly</h2>\n```\n</div>', ['Zorbly']],
  ['an <h2> whose backtick pairs with a later tag\'s', '<h2 title="`">Zorbly Labs</h2><span title="`"></span>', ['Zorbly Labs']],
  ['an <h2>, a blank line, then its text', '<h2>\n\nZorbly', ['Zorbly']],
  ['an indented <h2> in a <pre> after a blank line', '<pre>\n\n    <h2>Zorbly</h2>\n</pre>', ['Zorbly']],
  ['an <h2> whose attribute holds a <', '<h2 title="a<b">Zorbly Labs</h2>', ['Zorbly Labs']],
  ['an <h4> whose attribute is a lone <', '<h4 data-x="<">zorbly</h4>', ['zorbly']],
  ['an <h2> whose attribute reads like a heading tag', "<h2 title='<h3'>Zorbly</h2>", ['Zorbly']],
  ['an image in an <h2>', '<h2><img alt="Zorbly" src="z.png"></h2>', ['Zorbly']],
  // final-1b F1: a footnote definition holds a heading as a list item or a block quote does
  ['an ## heading in a footnote definition', 'See[^z].\n\n[^z]: ## Zorbly Labs', ['Zorbly Labs']],
  ['a lower-case #### in a footnote definition', 'See[^z].\n\n[^z]: #### zorbly', ['zorbly']],
  // final-1 F2: a # or ## heading's words also as a page shows them (references decoded, tags and comments
  // dropped); its text as written is what is refused. A comment splitting a word was refused before as well.
  ['an <h2> spelled with a character reference', '<h2>&#90;orbly</h2>', ['&#90;orbly']],
  ['an ## heading whose word an inline tag splits', '## Z<b>orbly</b>', ['Z<b>orbly</b>']],
  ['an ## heading whose word a comment splits', '## Zor<!-- -->bly', ['Zor<!-- -->bly']],
  // final-1 F3: a # or ## heading's link host is judged as its words are
  ['an ## heading of an autolink', '## <https://zorbly.example>', ['<https://zorbly.example>']],
  ['an ## heading whose link points at an unnamed host', '## [our partner](https://zorbly.example)', ['our partner']],
  // final-2 F1-2: a footnote's indented continuation is read, as a list item's is
  ['a lower-case #### in a footnote\'s continuation', 'See[^z].\n\n[^z]: a\n\n    #### zorbly', ['zorbly']],
  ['an ## heading in a footnote\'s continuation', 'See[^z].\n\n[^z]: a\n\n    ## Zorbly Labs', ['Zorbly Labs']],
  // final-2b I1, final-2 F4-2: invisible characters dropped; a quoted value, a comment and <?x?> read whole
  ['an ## heading split by a quoted > in an attribute', '## Z<b title=">">orbly</b>', ['Z<b title=">">orbly</b>']],
  ['an ## heading split by a comment holding >', '## Z<!-- a > b -->orbly', ['Z<!-- a > b -->orbly']],
  ['an ## heading split by a processing instruction', '## Z<?x?>orbly', ['Z<?x?>orbly']],
  ['an ## heading split by &shy;', '## Z&shy;orbly', ['Z&shy;orbly']],
  ['an ## heading split by &#173;', '## Z&#173;orbly', ['Z&#173;orbly']],
  ['an ## heading split by &#8203;', '## Z&#8203;orbly', ['Z&#8203;orbly']],
  ['an ## heading split by &zwj;', '## Z&zwj;orbly', ['Z&zwj;orbly']],
  ['an ## heading split by a soft hyphen', '## Z\u00ADorbly', ['Z\u00ADorbly']],
  ['an ## heading split by a zero-width space', '## Z\u200Borbly', ['Z\u200Borbly']],
  ['an ## heading split by a zero-width joiner', '## Z\u200Dorbly', ['Z\u200Dorbly']],
  ['an ## heading split by a word joiner', '## Z\u2060orbly', ['Z\u2060orbly']],
  // finals 3 and 3b: a # or ## heading's joined reading (markup removed with no separator, typed spaces kept)
  ['an ## heading split by a literal U+FEFF', '## Z\uFEFForbly', ['Z orbly']],
  ['a setext heading split by a literal U+FEFF', 'Z\uFEFForbly\n---', ['Z orbly']],
  ['an ## heading split by a declaration', '## Z<!x y>orbly', ['Z<!x y>orbly']],
  ['an ## heading split by a lower-case doctype', '## Z<!doctype y>orbly', ['Z<!doctype y>orbly']],
  ['an ## heading split by an end tag that closes nothing', '## Z</div>orbly', ['Z</div>orbly']],
  ['an ## heading split by a </section>', '## Z</section>orbly', ['Z</section>orbly']],
  ['an ## heading split by a <td> outside a table', '## Z<td>orbly', ['Z<td>orbly']],
  ['an <h2> split by an end tag that closes nothing', '<h2>Z</div>orbly</h2>', ['Z orbly']],
  ['an ## heading half struck through', '## Z~~orbly~~', ['Z~~orbly~~']],
  ['an ## heading of a decomposed capital', '## E\u0301mile', ['E\u0301mile']],
  ['a # heading of a decomposed capital', '# E\u0301mile', ['E\u0301mile']],
  ['an ## heading with a decomposed capital later', '## our rival E\u0301mile', ['our rival E\u0301mile']],
  ['an ## heading split by a quoted < in an attribute', '## Z<b title="<">orbly</b>', ['Z<b title="<">orbly</b>']],
  ['an ## heading split by a single-quoted <', "## Z<b title='<'>orbly</b>", ["Z<b title='<'>orbly</b>"]],
  ['an <h2> split by a quoted < in an attribute', '<h2>Z<b title="<">orbly</b></h2>', ['Z<b title=" orbly']],
  // finals 4 and 4b: mixed forms (what only seen dropped, with what only joined did), read joined
  ['an ## heading split by &shy; and a declaration', '## Z&shy;<!x y>orbly', ['Z&shy;<!x y>orbly']],
  ['an ## heading split by a CGJ and a U+FEFF', '## Z\u034F\uFEFForbly', ['Z\u034F orbly']],
  ['an ## heading split by &zwj; and strikethrough', '## Z&zwj;~~orbly~~', ['Z&zwj;~~orbly~~']],
  ['an ## heading split by a CGJ and a declaration', '## Z\u034F<!x y>orbly', ['Z\u034F<!x y>orbly']],
  ['an ## heading split by &#x34f; and strikethrough', '## Z&#x34f;~~orbly~~', ['Z&#x34f;~~orbly~~']],
  ['an ## heading split by a VS16 and an end tag', '## Z\uFE0F</div>orbly', ['Z\uFE0F</div>orbly']],
  ['an ## heading split by &lrm; and a <td>', '## Z&lrm;<td>orbly', ['Z&lrm;<td>orbly']],
  ['an ## heading split by a numeric default-ignorable and strikethrough', '## Z&#x2065;~~orbly~~', ['Z&#x2065;~~orbly~~']],
  // a reference link's brackets, and its label, taken out
  ['an ## heading a full reference link splits', '## Z[orbly][r]\n\n[r]: https://x.example', ['Z[orbly][r]']],
  ['an ## heading a collapsed reference link splits', '## Z[orbly][]\n\n[orbly]: https://x.example', ['Z[orbly][]']],
  ['an ## heading a shortcut reference link splits', '## Z[orbly]\n\n[orbly]: https://x.example', ['Z[orbly]']],
  ['an ## heading a reference link opens', '## [Z][r]orbly\n\n[r]: https://x.example', ['[Z][r]orbly']],
  // a combining mark NFKC cannot compose, dropped
  ['an ## heading of a capital with a combining low line', '## Z\u0332orbly', ['Z\u0332orbly']],
  ['an ## heading of a capital with an acute no letter takes', '## Q\u0301uux', ['Q\u0301uux']],
  // each span cut again where a page ends it, at its first >
  ['an ## heading an instruction splits, ended at its first >', '## Z<?x>orbly ?>', ['Z<?x>orbly ?>']],
  ['an ## heading a declaration holding < splits', '## Z<!x <y>orbly', ['Z<!x <y>orbly']],
  ['an ## heading a declaration holding a tag splits', '## Z<!x <b>orbly', ['Z<!x <b>orbly']],
  ['an <h2> an instruction splits', '<h2>Z<?x>orbly</h2>', ['Z orbly']],
  ['an <h2> a spaced end tag splits', '<h2>Z</ x>orbly</h2>', ['Z orbly']],
  ['an <h2> split by <!-->', '<h2>Z<!-->orbly</h2>', ['Z orbly']],
  ['an <h2> split by <!--->', '<h2>Z<!--->orbly</h2>', ['Z orbly']],
  ['an <h2> split by a comment ended --!>', '<h2>Z<!-- --!>orbly</h2>', ['Z orbly']],
  ['an ## heading a comment holding > and an instruction split', '## Z<!-- > --><?x>orbly ?>', ['Z<!-- > --><?x>orbly ?>']],
  ['an <h2> split by a tag CommonMark does not take', '<h2>Z<b_x>orbly</h2>', ['Z orbly']],
  ['an <h2> split by a tag with a stray quote', '<h2>Z<b a=x"y>orbly</h2>', ['Z orbly']],
  // finals 5 and 5b, and the ruling that a # or ## heading, and an HTML one, be plain text
  // (a-20261126-080419596): no raw HTML, character reference, \p{C} but a tab, mark left after NFC,
  // default-ignorable character, ~~, [ or ]
  ['an ## heading split inside a second bracket, by a declaration', '## [a][Z<!x y>orbly]', ['[a][Z<!x y>orbly]']],
  ['an ## heading split inside a second bracket, by strikethrough', '## [a][Z~~orbly~~]', ['[a][Z~~orbly~~]']],
  ['an ## heading split inside a second bracket, by a <td>', '## [a][Z<td>orbly]', ['[a][Z<td>orbly]']],
  ['an ## heading split inside a second bracket, by an end tag', '## [a][Z</div>orbly]', ['[a][Z</div>orbly]']],
  ['an ## heading split inside a second bracket, by a U+FEFF', '## [a][Z\uFEFForbly]', ['[a][Z orbly]']],
  ['an ## heading split after a lone ], by a declaration', '## rivals][Z<!x y>orbly]', ['rivals][Z<!x y>orbly]']],
  ['an <h2> split inside a second bracket', '<h2>[a][Z<!x y>orbly]</h2>', ['[a][Z orbly]']],
  ['a list item ## split inside a second bracket', '- ## [a][Z~~orbly~~]', ['[a][Z~~orbly~~]']],
  ['an ## heading split by a quoted > and an instruction', '## Z<b title=">"><?x>orbly ?>', ['Z<b title=">"><?x>orbly ?>']],
  ['an ## heading split by a single-quoted > and an instruction', '## Z<b title=\'>\'><?x>orbly ?>', ['Z<b title=\'>\'><?x>orbly ?>']],
  ['an ## heading split by a quoted > and a declaration holding <', '## Z<b title=">"><!x <y>orbly', ['Z<b title=">"><!x <y>orbly']],
  ['an ## heading split by strikethrough, a quoted > and an instruction', '## Z~~<b title=">">~~<?x>orbly ?>', ['Z~~<b title=">">~~<?x>orbly ?>']],
  ['an <h2> split by a quoted > and an instruction', '<h2>Z<b title=">"><?x>orbly</h2>', ['Z "> orbly']],
  ['an <h2> split by a quoted > and <!-->', '<h2>Z<b title=">"><!-->orbly</h2>', ['Z "> orbly']],
  ['an <h2> split by a quoted > and a comment ended --!>', '<h2>Z<b title=">"><!-- --!>orbly</h2>', ['Z "> orbly']],
  ['an <h2> split by a quoted > and a tag CommonMark does not take', '<h2>Z<b title=">"><b_x>orbly</h2>', ['Z "> orbly']],
  ['an ## heading split by an instruction and a quoted >', '## Z<?x><b title=">">orbly ?>', ['Z<?x><b title=">">orbly ?>']],
  ['a # heading split by an instruction and a quoted >', '# Z<?x><b title=">">orbly ?>', ['Z<?x><b title=">">orbly ?>']],
  ['a setext heading split by an instruction and a quoted >', 'Z<?x><b title=">">orbly ?>\n---', ['Z<?x><b title=">">orbly ?>']],
  ['a quoted ## split by an instruction and a quoted >', '> ## Z<?x><b title=">">orbly ?>', ['Z<?x><b title=">">orbly ?>']],
  ['an <h2> split by an instruction and a quoted >', '<h2>Z<?x><b title=">">orbly</b></h2>', ['Z ">orbly']],
  ['an ## heading split by a declaration holding < and a quoted >', '## Z<!x <y><b title=">">orbly</b>', ['Z<!x <y><b title=">">orbly</b>']],
  ['an <h2> split by a declaration holding < and a quoted >', '<h2>Z<!x <y><b title=">">orbly</b></h2>', ['Z<!x ">orbly']],
  ['an ## heading split by a quoted comment opener', '## Z<b title="<!-- >">orbly</b> -->', ['Z<b title="<!-- >">orbly</b> -->']],
  ['an <h2> split by <!--> and a quoted >', '<h2>Z<!--><b title=">">orbly</b></h2>', ['Z ">orbly']],
  ['an <h2> split by a comment ended --!> and a quoted >', '<h2>Z<!-- --!><b title=">">orbly</b></h2>', ['Z ">orbly']],
  ['an <h2> split by a tag CommonMark does not take and a quoted >', '<h2>Z<b_x><b title=">">orbly</b></h2>', ['Z ">orbly']],
  ['an <h2> split by a spaced end tag and a quoted >', '<h2>Z</ x><b title=">">orbly</b></h2>', ['Z ">orbly']],
  ['an <h2> split by an instruction and a single-quoted >', '<h2>Z<?x><b title=\'>\'>orbly</b></h2>', ['Z \'>orbly']],
  ['an <h2> split by &#173 with no ;', '<h2>Z&#173orbly</h2>', ['Z&#173orbly']],
  ['an <h2> split by &#xAD with no ;', '<h2>Z&#xADorbly</h2>', ['Z&#xADorbly']],
  ['an <h2> split by &shy with no ;', '<h2>Z&shyorbly</h2>', ['Z&shyorbly']],
  ['an <h2> split by &#847 with no ;', '<h2>Z&#847orbly</h2>', ['Z&#847orbly']],
  ['an <h2> split by &#xFEFF with no ;', '<h2>Z&#xFEFForbly</h2>', ['Z&#xFEFForbly']],
  ['an <h2> split by a hex reference with leading zeros', '<h2>Z&#x00000000AD;orbly</h2>', ['Z&#x00000000AD;orbly']],
  ['an <h2> split by a decimal reference with leading zeros', '<h2>Z&#00000000173;orbly</h2>', ['Z&#00000000173;orbly']],
  ['an ## heading opening with &angst;', '## &angst;rhus', ['&angst;rhus']],
  ['an ## heading opening with &ohm;', '## &ohm;mega', ['&ohm;mega']],
  ['an ## heading opening with &real;', '## &real;ivals', ['&real;ivals']],
  ['an ## heading opening with &image;', '## &image;nc', ['&image;nc']],
  ['an ## heading of a capital in an enclosing circle', '## Z\u20DDorbly', ['Z\u20DDorbly']],
  ['an ## heading of a capital in a keycap', '## Z\u20E3orbly', ['Z\u20E3orbly']],
  ['an ## heading of a capital with a spacing mark', '## Z\u0903orbly', ['Z\u0903orbly']],
  ['a lower-case ## heading holding a tag', '## our <b>rivals</b>', ['our <b>rivals</b>']],
  ['a lower-case ## heading holding a character reference', '## rivals &amp; vendors', ['rivals &amp; vendors']],
  ['a lower-case ## heading holding a private-use character', '## our\uE000rivals', ['our\uE000rivals']],
  ['a lower-case ## heading holding a combining mark', '## our rivals\u20DD', ['our rivals\u20DD']],
  ['a lower-case ## heading holding a Hangul filler', '## our\u3164rivals', ['our\u3164rivals']],
  ['a lower-case ## heading holding strikethrough', '## our ~~old~~ rivals', ['our ~~old~~ rivals']],
  ['a lower-case ## heading holding a bracket', '## our [rivals]', ['our [rivals]']],
  ['a lower-case ## heading holding a lone ]', '## our rivals]', ['our rivals]']],
  ['an <h3> of a named word in a tag', '<h3><b>Vendors</b></h3>', ['Vendors']],
  ['an <h2> outside code split by a tag', '<h2>Z<b>orbly</b></h2>', ['Z orbly']],
  ['an <h2> in a fence, split by a tag, by the names rule as before', '```\n<h2>Z<b>orbly</b></h2>\n```', ['Z orbly']],
  ['an ## heading of named words, one in an inline tag', '## <em>What</em> to watch', ['<em>What</em> to watch']],
  ['an ## heading of named words a <br> divides', '## What<br>to watch', ['What<br>to watch']],
  ['an ## heading of named words a <p> divides', '## What<p>to watch</p>', ['What<p>to watch</p>']],
  // finals 6 and 6b (ruling m-20261126-121428851): an HTML heading tag is code only where a page keeps it
  // as text, in a fence or indented code outside an HTML block, or wholly inside a comment or a code span
  // its line doesn't break; and the Minors' rows, each holding one thing
  ['an <h2> a backtick paragraph wraps', '`x\n<h2>Z<b title=">"><?x>orbly</h2>\n`', ['Z "> orbly']],
  ['an <h2> of a split label a backtick paragraph wraps', '`x\n<h2>[a][Z<!x y>orbly]</h2>\n`', ['[a][Z orbly]']],
  ['an <h2> after a comment that opens its line', '<!-- x --><h2>Z<b title=">"><?x>orbly</h2>', ['Z "> orbly']],
  ['an <h2> after a comment that closes on its line', '<!-- x\n--><h2>[a][Z<!x y>orbly]</h2>', ['[a][Z orbly]']],
  ['an <h2> that ends a paragraph holding a comment opener', 'a <!--\n<h2>Z<b title=">"><?x>orbly</h2>\n-->', ['Z "> orbly']],
  ['an <h2> of a quoted > and an instruction after a comment on its line', '<!-- c --><h2>Z<b title=">"><?x>orbly</h2>', ['Z "> orbly']],
  ['an <h2> of a quoted > and an instruction in a list item after a backtick in the item before', '- a `x\n- <h2>Z<b title=">"><?x>orbly</h2> `', ['Z "> orbly']],
  ['an <h2> of a quoted > and an instruction after an ## heading holding a backtick', '## a `x\n<h2>Z<b title=">"><?x>orbly</h2> `', ['Z "> orbly']],
  ['an <h2> of a quoted > and an instruction between fence marks in a <div>', '<div>\n```\n<h2>Z<b title=">"><?x>orbly</h2>\n```\n</div>', ['Z "> orbly']],
  ['an <h2> of a quoted > and an instruction indented in a <pre> after a blank line', '<pre>\n\n    <h2>Z<b title=">"><?x>orbly</h2>\n</pre>', ['Z "> orbly']],
  ['an <h2> of a split label after a comment on its line', '<!-- c --><h2>[a][Z<!x y>orbly]</h2>', ['[a][Z orbly]']],
  ['an <h2> of a split label in a list item after a backtick in the item before', '- a `x\n- <h2>[a][Z<!x y>orbly]</h2> `', ['[a][Z orbly]']],
  ['an <h2> of a split label after an ## heading holding a backtick', '## a `x\n<h2>[a][Z<!x y>orbly]</h2> `', ['[a][Z orbly]']],
  ['an <h2> of a split label between fence marks in a <div>', '<div>\n```\n<h2>[a][Z<!x y>orbly]</h2>\n```\n</div>', ['[a][Z orbly]']],
  ['an <h2> of a split label indented in a <pre> after a blank line', '<pre>\n\n    <h2>[a][Z<!x y>orbly]</h2>\n</pre>', ['[a][Z orbly]']],
  ['an <h2> of &#173 after a comment on its line', '<!-- c --><h2>Z&#173orbly</h2>', ['Z&#173orbly']],
  ['an <h2> of &#173 in a list item after a backtick in the item before', '- a `x\n- <h2>Z&#173orbly</h2> `', ['Z&#173orbly']],
  ['an <h2> of &#173 after an ## heading holding a backtick', '## a `x\n<h2>Z&#173orbly</h2> `', ['Z&#173orbly']],
  ['an <h2> of &#173 between fence marks in a <div>', '<div>\n```\n<h2>Z&#173orbly</h2>\n```\n</div>', ['Z&#173orbly']],
  ['an <h2> of &#173 indented in a <pre> after a blank line', '<pre>\n\n    <h2>Z&#173orbly</h2>\n</pre>', ['Z&#173orbly']],
  ['an <h2> after an empty comment <!-->', '<!--> <h2>Z<b title=">"><?x>orbly</h2> -->', ['Z "> orbly']],
  ['an <h2> after an empty comment <!--->', 'a <!---> <h2>Z<b title=">"><?x>orbly</h2> -->', ['Z "> orbly']],
  ['an <h2> in a comment holding --!>', 'a <!-- x --!> <h2>Z<b title=">"><?x>orbly</h2> -->', ['Z "> orbly']],
  ['an <h2> in backticks in a <div> line', '<div>`<h2>Z<b title=">"><?x>orbly</h2>`</div>', ['Z "> orbly']],
  ['an <h2> in backticks in an HTML block', '<div>\n`<h2>Z<b title=">"><?x>orbly</h2>`\n</div>', ['Z "> orbly']],
  ['an <h2> in a span the line before breaks', 'a `b\n`<h2>Z<b title=">"><?x>orbly</h2>`', ['Z "> orbly']],
  ['an <h2> in a span a table cell splits', '| a | b |\n|---|---|\n| `x | <h2>Z<b title=">"><?x>orbly</h2> ` | c |', ['Z "> orbly']],
  ['an <h2> after a tag whose value holds a comment opener', 'a <b title="<!--"> <h2>Z<b title=">"><?x>orbly</h2> -->', ['Z "> orbly']],
  ['an <h2> after a tag whose value holds a backtick', 'a <b title="`"> <h2>Z<b title=">"><?x>orbly</h2> `', ['Z "> orbly']],
  ['an <h2> after an escaped comment opener', 'a \\<!-- <h2>Z<b title=">"><?x>orbly</h2> -->', ['Z "> orbly']],
  ['an <h2> between fence marks in an HTML block of a custom tag', '<x-note>\n```\n<h2>Z<b title=">"><?x>orbly</h2>\n```\n</x-note>', ['Z "> orbly']],
  ['an <h2> after an HTML block that a fence mark opened in', '<div>\n```\n\n<h2>Z<b title=">"><?x>orbly</h2>\n```', ['Z "> orbly']],
  ['an <h2> in a list item after a comment opener in the item before', '- a <!--\n- b <h2>Z<b title=">"><?x>orbly</h2> -->', ['Z "> orbly']],
  ['an <h2> after an ## heading holding a comment opener', '## a <!--\nb <h2>Z<b title=">"><?x>orbly</h2> -->', ['a <!--', 'Z "> orbly']],
  ['a lower-case ## heading holding a closing tag', '## our rivals</b>', ['our rivals</b>']],
  ['a lower-case ## heading holding a declaration', '## our <!x> rivals', ['our <!x> rivals']],
  ['a lower-case ## heading holding an instruction', '## our <?x?> rivals', ['our <?x?> rivals']],
  ['a lower-case ## heading holding a lone [', '## our [rivals', ['our [rivals']],
  ['a lower-case ## heading holding a comment', '## our <!-- x --> rivals', ['our <!-- x --> rivals']],
  ['a lower-case <h2> holding markup in backticks', '<h2>our `<b>` rivals</h2>', ['our rivals']],
];
const NOT_REFUSED = [
  ['an ## heading in a fence', '```\n## Zorbly\n```'],
  ['a setext heading in a ~~~ fence', '~~~\nZorbly\n---\n~~~'],
  ['an ## heading in indented code', '    ## Zorbly'],
  ['an ## heading in a comment', '<!--\n## Zorbly\n-->'],
  ['an ## heading in a code span', 'See `## Zorbly` here.'],
  ['a # with no space', '#Zorbly is a tag.'],
  ['a break after a blank line', 'Zorbly is here.\n\n---'],
  ['a lower-case ## heading', '## zorbly co'],
  ['an ## heading of named words', '## What to watch'],
  ['an <h2> of a named word', '<h2>Vendors</h2>'],
  ['a setext heading of a named word', 'Forces\n==='],
  ['a named ### in a list item', '- ### Ledgerpad'],
  ['a named #### in a block quote', '> #### Acme Storage'],
  ['a dependency name as an <h5>', '<h5>inkwell-sync</h5>'],
  // what stays plain text: a code span, a tab, a line's end in an HTML heading, a mark NFC composes,
  // * and _ emphasis; and a heading of level 3 to 6 that is not HTML is judged by its words only
  ['an ## heading holding a code span of markup', '## the `<div>` and `[x]` tags'],
  ['an ## heading holding a tab', '## our\trivals'],
  ['an <h2> of two lines', '<h2>our\nrivals</h2>'],
  ['an ## heading whose mark NFC composes', '## our cafe\u0301 list'],
  ['an ## heading with * and _ emphasis', '## our *rivals* and _vendors_'],
  ['a #### heading of a named link', '#### [Ledgerpad](https://ledgerpad.example)'],
  ['a named <h3> with markup quoted in a code span', 'See `<h3><b>Ledgerpad</b></h3>` here.'],
  ['a named <h2> with markup in a fence', '```\n<h2><b>What</b> to watch</h2>\n```'],
  ['a named <h2> with markup in indented code', '    <h2><b>What</b> to watch</h2>'],
  ['a named <h2> with markup in a comment', '<!-- <h2><b>What</b> to watch</h2> -->'],
  ['an ## heading of a command whose options are in code spans', '## box-supervisors `[--all]` `[--dry-run]`'],
  ['a # heading whose placeholder is in a code span', '# kit-797-reply-parts: thread reply `--part <n>` and --after-parts'],
  ['an ## heading whose path placeholder is in a code span', '## cmdline.mjs (a scan of every `/proc/<pid>/stat` at two reads at once)'],
  // finals 6 and 6b: where a page does keep a heading tag as text
  ['a named <h2> with markup in a comment of three lines', '<!--\n<h2><b>What</b> to watch</h2>\n-->'],
  ['a named <h2> with markup in a comment inside a paragraph', 'Some <!-- <h2><b>What</b> to watch</h2> --> words.'],
  ['a named <h2> with markup in a code span in a list item', '- see `<h2><b>What</b> to watch</h2>` here'],
  ['a named <h2> with markup in a code span in a table row', '| a | `<h2><b>What</b> to watch</h2>` |\n|---|---|'],
  ['a named <h2> with markup in a fence after a closed <div>', '<div>\n</div>\n\n```\n<h2><b>What</b> to watch</h2>\n```'],
];
const formOpts = (visibility, names = allowed.names) => ({ today: W2.today, visibility, allowed: { ...allowed, names } });

test('F1 every heading form is refused on a public or unknown repo, in the reference and the region', () => {
  const P = plainOf();
  const wrong = []; // every form that fails, each named, so a red run shows them all
  for (const [what, x, want] of HEADING_FORMS) {
    for (const [who, check] of [['reference', refCheckExterior], ['region', P.checkExterior]]) {
      for (const v of ['public', 'unknown']) { const got = copy(check(formDoc(x), formOpts(v)).refused); if (JSON.stringify(got) !== JSON.stringify(want)) wrong.push(`${who} ${v}: ${what} refused ${JSON.stringify(got)}`); }
      const got = copy(check(formDoc(x), formOpts('private')).refused);
      if (got.length) wrong.push(`${who} private: ${what} refused ${JSON.stringify(got)}`);
    }
  }
  assert.deepEqual(wrong, [], `F1 each form refused as listed:\n${wrong.join('\n')}`);
  const all = formDoc('## Zorbly\n\nBrindle\n---\n\n<h4>Cartwell</h4>\n\n> ### Zorbly');
  for (const [who, check] of [['reference', refCheckExterior], ['region', P.checkExterior]]) assert.deepEqual(copy(check(all, formOpts('public')).refused), ['Zorbly', 'Brindle', 'Cartwell', 'Zorbly'], `F1 ${who}: in document order, each time`);
});

test('F2 what a page does not show as a heading, or shows with named words, is not refused', () => {
  const P = plainOf();
  for (const [what, x] of NOT_REFUSED) {
    for (const [who, check] of [['reference', refCheckExterior], ['region', P.checkExterior]]) assert.deepEqual(copy(check(formDoc(x), formOpts('public')).refused), [], `F2 ${who}: ${what} is not refused`);
  }
  // the title's own word: Exterior counts as named in a # or ## heading, though nothing names it
  for (const [who, check] of [['reference', refCheckExterior], ['region', P.checkExterior]]) {
    assert.deepEqual(copy(check('# Exterior\n\n### inkwell-sync\n', formOpts('public', 'inkwell-sync')).refused), [], `F2 ${who}: the # Exterior title is not refused`);
    assert.deepEqual(copy(check('# Exterior\n\n### Exterior\n', formOpts('public', 'inkwell-sync')).refused), ['Exterior'], `F2 ${who}: a ### Exterior is judged whole, as before`);
  }
});

test('F3 exterior check, chore pr and check-pr refuse a heading of another form, worded as one', withProject('x-forms', {}, async (W, check) => {
  const FORMS_EXT = `${EXTERIOR}\n## Zorbly Labs\n\n<h3>Brindle</h3>\n`;
  await check('F3 exterior check: an error per heading, "(a heading)", exit 1; private: none', () => {
    for (const v of ['public', 'unknown']) {
      W.setVisibility(v);
      write(path.join(W.old, EXT), FORMS_EXT);
      const r = W.run(['exterior', 'check']);
      assert.equal(r.status, 1, `F3 ${v}: exterior check exits 1\n${r.text}`);
      for (const n of ['Zorbly Labs', 'Brindle']) assert.match(r.out, new RegExp(`^error: exterior\\.md: "${n}" \\(a heading\\) is not named in origin main's strategy\\.md or its dependency names`, 'm'), `F3 ${v}: "${n}" refused as a heading\n${r.out}`);
      assert.doesNotMatch(r.out, /\(a ### heading\)/, `F3 ${v}: not worded as a ### heading\n${r.out}`);
    }
    W.setVisibility('private');
    const r = W.run(['exterior', 'check']);
    assert.equal(r.status, 0, `F3 private: exterior check passes\n${r.text}`);
    fs.rmSync(path.join(W.old, EXT));
  });
  await check('F3 chore pr refuses them with every word named on the chore; nothing pushed', () => {
    W.setVisibility('public');
    const p = W.chorePr('forms', (w) => write(path.join(w, EXT), FORMS_EXT), ['--names-checked', 'Zorbly,Labs,Brindle']);
    assert.notEqual(p.status, 0, `F3 chore pr refuses\n${p.text}`);
    for (const n of ['Zorbly Labs', 'Brindle']) assert.match(p.text, new RegExp(`"${n}" \\(a heading\\)`), `F3 chore pr names "${n}"\n${p.text}`);
    assert.ok(!p.pushed(), 'F3 nothing pushed');
  });
  await check('F3 check-pr fails each on a public repo', () => {
    W.setVisibility('public');
    const sha = W.commitOn('forms2', (x) => write(path.join(x, EXT), FORMS_EXT));
    const c = W.checkPr('chore-forms2', sha);
    for (const n of ['Zorbly Labs', 'Brindle']) assert.match(lines(c.out, 'fail').join('\n'), new RegExp(`"${n}" \\(a heading\\)`), `F3 check-pr fails "${n}"\n${c.out}`);
  });
}));

test('F4 exterior-drift reads every heading form as the draft does', withProject('x-drift-forms', { exterior: `${world2('exterior.md')}\n<h2>Zorbly</h2>\n\n> #### Brindle\n` }, async (W, check) => {
  await check('F4 last known public: one exterior-drift per heading another form names, keyed by it', () => {
    W.record('public');
    const keys = W.findings(['exterior-drift']).map((f) => f.key).sort();
    assert.deepEqual(keys, ['brindle', 'zorbly'], 'F4 an <h2> and a #### in a block quote drift');
  });
}));

test('F5 headBlobs reads the working tree only; the region returns only what is read', () => {
  const at = SRC.indexOf('function headBlobs(');
  assert.ok(at > 0, 'F5 headBlobs is defined');
  const body = SRC.slice(at, SRC.indexOf('\n}\n', at));
  assert.match(body, /^function headBlobs\(\) \{/, `F5 headBlobs takes nothing\n${body.split('\n')[0]}`);
  assert.doesNotMatch(body, /\bref\b|\broot\b|rev-parse/, `F5 no ref branch and no root\n${body}`);
  const comment = SRC.slice(0, at).split('\n').reverse().slice(1).filter((_, i, a) => a.slice(0, i + 1).every((l) => l.startsWith('//'))).reverse().join('\n');
  assert.match(comment, /working tree/, `F5 its comment says it reads the working tree\n${comment}`);
  assert.doesNotMatch(comment, /\bref\b/, `F5 its comment no longer speaks of a ref\n${comment}`);
  const keys = Object.keys(plainOf());
  for (const k of ['entries', 'capitalised', 'hosts']) assert.ok(!keys.includes(k), `F5 the region no longer returns ${k}: ${keys}`);
  for (const k of ['checkExterior', 'headings', 'namesWhole']) assert.ok(keys.includes(k), `F5 the region still returns ${k}`);
});

test('F6 the contract and the help say every heading form', () => {
  const S = JSON.parse(fs.readFileSync(new URL('../docs/devteam/schema/log.schema.json', import.meta.url), 'utf8'));
  const d = S.$defs.exterior2.description;
  assert.doesNotMatch(d, /each ### heading must be named whole/, 'F6 the schema no longer limits the rule to ###');
  assert.doesNotMatch(d, /Headings in code or a comment are not read\./, 'F6 the schema no longer says no heading in code or a comment is read');
  assert.ok(d.includes('underlined with = or -'), 'F6 the schema says what a setext heading is, in plain words');
  for (const w of ['or a footnote', 'but Exterior, or a link host', 'as the page shows them']) assert.ok(d.includes(w), `F6 the schema says "${w}"`);
  for (const w of ['every heading', 'setext', '<h1>', 'list item or block quote', 'wherever it stands', 'level 3 to 6', 'capitalised word but Exterior']) assert.ok(d.includes(w), `F6 the schema says "${w}"`);
  const help = SRC.slice(SRC.indexOf('const HELP_OBSERVE')).split('\n').find((l) => l.includes('exterior show'));
  assert.doesNotMatch(help, /a ### heading not named whole/, `F6 the help no longer limits the rule to ###: ${help}`);
  assert.match(help, /a heading of any form/, `F6 the help says any form: ${help}`);
  assert.match(help, /but Exterior, or a link host, not named whole/, `F6 the help says a # or ## heading's link host is judged: ${help}`);
  assert.ok(d.includes('a top-level heading must be plain text'), 'F6 the schema says a top-level heading must be plain text');
  for (const w of ['raw HTML', 'a character reference', '~~', 'a [ or ]', 'code span']) assert.ok(d.includes(w), `F6 the schema says "${w}"`);
  assert.match(help, /a top-level heading must be plain text/, `F6 the help says a top-level heading must be plain text: ${help}`);
});

test('F7 a refused # or ## heading says to name it in the strategy or reword it, once', withProject('x-forms-once', {}, async (W, check) => {
  await check('F7 exterior check: one error per refused heading, with its fix', () => {
    W.setVisibility('public');
    write(path.join(W.old, EXT), `${EXTERIOR}\n## Zorbly Labs\n\nSome words.\n\n## Zorbly Labs\n`);
    const r = W.run(['exterior', 'check']);
    assert.equal(r.status, 1, `F7 exterior check exits 1\n${r.text}`);
    const got = r.out.split('\n').filter((l) => l.includes('"Zorbly Labs" (a heading)'));
    assert.equal(got.length, 1, `F7 one line for the heading written twice\n${r.out}`);
    assert.match(got[0], /name it in the strategy first, or reword it/, `F7 the line says to name it in the strategy or reword it\n${got[0]}`);
    fs.rmSync(path.join(W.old, EXT));
  });
  await check('F7 exterior check: a heading that is not plain text says so, once', () => {
    W.setVisibility('public');
    write(path.join(W.old, EXT), `${EXTERIOR}\n## our ~~old~~ rivals\n\nSome words.\n\n## our ~~old~~ rivals\n`);
    const r = W.run(['exterior', 'check']);
    assert.equal(r.status, 1, `F7 exterior check exits 1\n${r.text}`);
    const got = r.out.split('\n').filter((l) => l.includes('"our ~~old~~ rivals" (a heading)'));
    assert.equal(got.length, 1, `F7 one line for the heading written twice\n${r.out}`);
    assert.match(got[0], /a top-level heading must be plain text; put options, placeholders and markup in backticks/, `F7 the line says a top-level heading must be plain text, and how to fix it\n${got[0]}`);
    assert.doesNotMatch(got[0], /name it in the strategy first/, `F7 not the names rule's fix\n${got[0]}`);
    fs.rmSync(path.join(W.old, EXT));
  });
}));
