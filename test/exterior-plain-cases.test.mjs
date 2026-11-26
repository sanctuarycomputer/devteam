// kit-863 P3: every world2 exterior case through check-pr, at its own commit, giving the reference
// checker's result (cases.json's visibility through a fake gh; its dates moved by as many days as
// today is past cases.json's today, so a date's place before or after today is the case's). Apart
// from exterior-plain.test.mjs for time: one commit and one check-pr per case.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { write } from './lib/kit.mjs';
import { fixture, SUP } from './lib/next-step-fixture.mjs';
import { checkExterior as refCheckExterior, headings as refHeadings } from './fixtures/world2/check.mjs';

const P = 'docs/devteam/project';
const STRAT = `${P}/strategy.md`;
const EXT = `${P}/exterior.md`;
const world2 = (f) => fs.readFileSync(new URL(`./fixtures/world2/${f}`, import.meta.url), 'utf8');
const W2 = JSON.parse(world2('cases.json'));
const CASES = W2.cases.filter((c) => c.doc === 'exterior');
const PKG = JSON.stringify(W2.package);
const allowed = { names: `${world2('strategy.md')}\n${Object.keys(W2.package.dependencies).join('\n')}`, words: `${world2('strategy.md')}\n${PKG}` };
// today, and each real date of a text moved by as many days as today is past cases.json's
const TODAY = new Date().toISOString().slice(0, 10);
const DAY = 86400000;
const SHIFT = Math.round((Date.parse(`${TODAY}T00:00:00Z`) - Date.parse(`${W2.today}T00:00:00Z`)) / DAY);
const realDay = (d) => { const t = new Date(`${d}T00:00:00Z`); return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d; };
const shifted = (text) => text.replace(/(?<!\d)\d{4}-\d{2}-\d{2}(?!\d)/g, (d) => (realDay(d) ? new Date(Date.parse(`${d}T00:00:00Z`) + SHIFT * DAY).toISOString().slice(0, 10) : d));
// what the reference says of a case, as the fixture reads it
// The wording a refused heading's line takes: "(a ### heading)" only where text heads an entry with
// it (a level-3 ATX heading), "(a heading)" for any other form or level (kit-933).
const formOf = (text, n) => (refHeadings(text).some((h) => h.level === 3 && h.text === n) ? '(a ### heading)' : '(a heading)');
const oracle = (c) => refCheckExterior(shifted(world2(c.file)), { today: TODAY, visibility: c.visibility, allowed });

function proj(name) {
  const F = fixture(name);
  const { old, g } = F;
  const bin = path.join(F.base, 'bin');
  const visFile = path.join(F.base, 'visibility');
  g(['config', `url.${F.org}.insteadOf`, 'https://github.com/acme/quillmark.git'], old);
  g(['remote', 'set-url', 'origin', 'https://github.com/acme/quillmark.git'], old);
  write(path.join(bin, 'gh'), `#!/bin/sh\ncase "$*" in *acme/quillmark*) ;; *) exit 1 ;; esac\nif [ "$1 $2" = "repo view" ] && [ -s '${visFile}' ]; then cat '${visFile}'; exit 0; fi\nexit 1\n`);
  fs.chmodSync(path.join(bin, 'gh'), 0o755);
  const setVisibility = (v) => fs.writeFileSync(visFile, v === 'unknown' ? '' : `${v.toUpperCase()}\n`);
  const ENV = { ...SUP, PATH: `${bin}${path.delimiter}${process.env.PATH}` };
  const run = (args, cwd = old) => { const r = F.run(cwd, args, ENV); return { status: r.status, out: r.out, err: r.err, text: `${r.out}\n${r.err}` }; };
  write(path.join(old, STRAT), world2('strategy.md'));
  write(path.join(old, 'package.json'), PKG);
  g(['add', '-A'], old);
  g(['commit', '-qm', 'fixture'], old);
  g(['push', '-q', 'origin', 'main'], old);
  const body = path.join(F.base, 'pr-body.md');
  write(body, 'x\n\n## One-way doors\n\nNone.\n');
  const checkPr = (headRef, sha) => run(['check-pr', '--head-ref', headRef, '--sha', sha, '--title', `${headRef}: x`, '--body-file', body]);
  return { ...F, run, checkPr, setVisibility };
}
const withProject = (name, body) => async (t) => {
  const W = proj(name);
  try { await body(W, (title, fn) => t.test(title, fn)); } finally { W.done(); }
};

test('the cases as the fixture reads them keep cases.json\'s result', () => {
  assert.equal(CASES.length, 105);
  for (const c of CASES) {
    const o = oracle(c);
    for (const k of ['errors', 'warnings']) assert.equal(o[k].length, c.expect[k].length, `${c.file} ${k}`);
    for (const k of ['refused', 'held', 'hosts']) assert.deepEqual(o[k], c.expect[k], `${c.file} ${k}`);
  }
});

test('P3 check-pr gives each world2 exterior case the reference\'s result', withProject('x-cases', async (W, check) => {
  await check('P3 check-pr: each case at its own commit on main', () => {
    const w = path.join(W.old, '.worktrees', 'chore-cases');
    W.g(['worktree', 'add', '-q', '-b', 'chore-cases', w, 'origin/main'], W.old);
    write(path.join(W.old, 'docs/devteam/run/pr/chore-cases.md'), '# chore-cases: x\n\n## One-way doors\n\nNone.\n');
    for (const c of CASES) {
      W.setVisibility(c.visibility);
      W.g(['reset', '-q', '--hard', 'origin/main'], w);
      write(path.join(w, EXT), shifted(world2(c.file)));
      W.g(['add', '-A'], w);
      W.g(['commit', '-qm', c.file], w);
      W.g(['push', '-qf', 'origin', 'chore-cases'], w);
      const sha = W.g(['rev-parse', 'HEAD'], w);
      const o = oracle(c);
      const r = W.checkPr('chore-cases', sha);
      const mine = (kind) => [...r.out.matchAll(new RegExp(`^${kind}: (.*)$`, 'gm'))].map((m) => m[1]).filter((l) => l.includes('exterior.md') && !l.startsWith('changes '));
      const fails = mine('fail');
      const warns = mine('warn');
      const contract = fails.filter((l) => / breaks exterior@2 at [0-9a-f]{12}: /.test(l)).map((l) => l.replace(/^.* breaks exterior@2 at [0-9a-f]{12}: /, ''));
      assert.deepEqual(contract, o.errors, `P3 check-pr's contract lines on ${c.file}\n${r.out}`);
      const pub = c.visibility === 'public';
      const unk = c.visibility === 'unknown';
      // each refused heading's name and wording, which pins its form
      const named = (lines) => lines.filter((l) => /"[^"]*" \(a (?:### )?heading\)/.test(l)).map((l) => /^.*?"(.*?)" (\(a (?:### )?heading\)).*$/.exec(l).slice(1, 3));
      const formed = o.refused.map((n) => [n, formOf(shifted(world2(c.file)), n)]);
      const words = (lines) => lines.filter((l) => / names ".*?" \((word|link host)\)/.test(l)).map((l) => l.replace(/^.*? names "(.*?)" \((word|link host)\).*$/, '$1'));
      assert.deepEqual(named(fails), pub ? formed : [], `P3 check-pr fails each refused heading on a public repo: ${c.file}\n${r.out}`);
      assert.deepEqual(named(warns), unk ? formed : [], `P3 check-pr warns of each on an unknown one: ${c.file}\n${r.out}`);
      assert.deepEqual(words(fails), pub ? [...o.held, ...o.hosts] : [], `P3 check-pr fails each held word and host on a public repo: ${c.file}\n${r.out}`);
      assert.deepEqual(words(warns), unk ? [...o.held, ...o.hosts] : [], `P3 check-pr warns of each on an unknown one: ${c.file}\n${r.out}`);
      assert.equal(fails.length, contract.length + named(fails).length + words(fails).length, `P3 no other fail on ${c.file}\n${r.out}`);
      for (const x of o.warnings) assert.ok(warns.some((l) => l.endsWith(x)), `P3 check-pr warns "${x}" on ${c.file}\n${r.out}`);
    }
  });
}));
