// kit-863 P4: every world2 exterior case through chore pr, each pushed case's remote branch removed
// after the push so each case is the only version read; apart from exterior-plain.test.mjs for time.
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
const TODAY = new Date().toISOString().slice(0, 10);
const DAY = 86400000;
const SHIFT = Math.round((Date.parse(`${TODAY}T00:00:00Z`) - Date.parse(`${W2.today}T00:00:00Z`)) / DAY);
const realDay = (d) => { const t = new Date(`${d}T00:00:00Z`); return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d; };
const shifted = (text) => text.replace(/(?<!\d)\d{4}-\d{2}-\d{2}(?!\d)/g, (d) => (realDay(d) ? new Date(Date.parse(`${d}T00:00:00Z`) + SHIFT * DAY).toISOString().slice(0, 10) : d));
// The wording a refused heading's line takes: "(a ### heading)" only where text heads an entry with
// it (a level-3 ATX heading), "(a heading)" for any other form or level (kit-933).
const formOf = (text, n) => (refHeadings(text).some((h) => h.level === 3 && h.text === n) ? '(a ### heading)' : '(a heading)');
const oracle = (c) => refCheckExterior(shifted(world2(c.file)), { today: TODAY, visibility: c.visibility, allowed });

test('P4 chore pr refuses or pushes each world2 exterior case as the reference says', async () => {
  const F = fixture('x-chore');
  try {
    const { old, g } = F;
    const bin = path.join(F.base, 'bin');
    const visFile = path.join(F.base, 'visibility');
    g(['config', `url.${F.org}.insteadOf`, 'https://github.com/acme/quillmark.git'], old);
    g(['remote', 'set-url', 'origin', 'https://github.com/acme/quillmark.git'], old);
    write(path.join(bin, 'gh'), `#!/bin/sh\ncase "$*" in *acme/quillmark*) ;; *) exit 1 ;; esac\nif [ "$1 $2" = "repo view" ] && [ -s '${visFile}' ]; then cat '${visFile}'; exit 0; fi\nexit 1\n`);
    fs.chmodSync(path.join(bin, 'gh'), 0o755);
    const ENV = { ...SUP, PATH: `${bin}${path.delimiter}${process.env.PATH}` };
    const run = (args) => { const r = F.run(old, args, ENV); return { status: r.status, text: `${r.out}\n${r.err}` }; };
    write(path.join(old, STRAT), world2('strategy.md'));
    write(path.join(old, 'package.json'), PKG);
    g(['add', '-A'], old);
    g(['commit', '-qm', 'fixture'], old);
    g(['push', '-q', 'origin', 'main'], old);
    const w = path.join(old, '.worktrees', 'chore-drafts');
    assert.equal(run(['chore', 'start', 'drafts']).status, 0, 'chore start');
    const tip = () => g(['ls-remote', 'origin', 'refs/heads/chore-drafts'], old).split('\t')[0] || null;
    const names = () => fs.readdirSync(path.join(old, 'docs/devteam/run/log')).filter((f) => f.endsWith('.jsonl')).flatMap((f) => fs.readFileSync(path.join(old, 'docs/devteam/run/log', f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))).filter((x) => x.class === 'names-checked' && x.scope === 'exterior');
    for (const c of CASES) {
      fs.writeFileSync(visFile, c.visibility === 'unknown' ? '' : `${c.visibility.toUpperCase()}\n`);
      write(path.join(w, EXT), shifted(world2(c.file)));
      const o = oracle(c);
      const open = c.visibility !== 'private';
      const words = open ? [...o.held, ...o.hosts] : [];
      const refused = open ? o.refused : [];
      const r = run(['chore', 'pr', 'drafts', '--title', 'drafts']);
      for (const e of o.errors) assert.ok(r.text.includes(`exterior.md: ${e}`), `P4 chore pr on ${c.file} says "${e}"\n${r.text}`);
      for (const n of refused) assert.ok(r.text.includes(`"${n}" ${formOf(shifted(world2(c.file)), n)} `), `P4 chore pr on ${c.file} refuses "${n}" as ${formOf(shifted(world2(c.file)), n)}\n${r.text}`);
      for (const x of words) assert.ok(r.text.includes(`"${x}" (`), `P4 chore pr on ${c.file} holds "${x}"\n${r.text}`);
      const pushes = !o.errors.length && !refused.length && !words.length;
      assert.equal(r.status === 0, pushes, `P4 chore pr ${pushes ? 'pushes' : 'refuses'} ${c.file}\n${r.text}`);
      if (!pushes && !o.errors.length && !refused.length && words.some((x) => x.includes(','))) {
        // --names-checked splits at commas: a host holding one is never named, only reworded
        const again = run(['chore', 'pr', 'drafts', '--title', 'drafts', '--names-checked', words.filter((x) => !x.includes(',')).join(',')]);
        assert.notEqual(again.status, 0, `P4 chore pr on ${c.file} still holds what holds a comma\n${again.text}`);
        assert.match(again.text, /holds? a comma, which --names-checked can't name: reword/, `P4 ${c.file} says to reword it\n${again.text}`);
        assert.equal(tip(), null, `P4 ${c.file}: nothing pushed`);
      } else if (!pushes && !o.errors.length && !refused.length) {
        // held until named: naming each word and host on the chore lets it out, and logs them
        const before = names().length;
        const again = run(['chore', 'pr', 'drafts', '--title', 'drafts', '--names-checked', words.join(',')]);
        assert.equal(again.status, 0, `P4 chore pr on ${c.file} pushes once each word is named\n${again.text}`);
        assert.equal(names().length, before + 1, `P4 ${c.file}: one names-checked act`);
        assert.deepEqual(names().pop().refs, ['chore-drafts', ...words.map((x) => `name:${x}`)], `P4 ${c.file}: the act names each`);
      } else if (refused.length && !o.errors.length) {
        // a refused heading is never cleared by naming it
        const again = run(['chore', 'pr', 'drafts', '--title', 'drafts', '--names-checked', [...refused, ...words].join(',')]);
        assert.notEqual(again.status, 0, `P4 chore pr on ${c.file} still refuses with every name checked\n${again.text}`);
        assert.equal(tip(), null, `P4 ${c.file}: nothing pushed`);
      } else if (!pushes) assert.equal(tip(), null, `P4 ${c.file}: nothing pushed`);
      if (tip()) {
        // each case is the only version since main: the pushed branch goes, the worktree back to main
        g(['push', '-q', 'origin', '--delete', 'chore-drafts'], old);
      }
      g(['reset', '-q', '--hard', 'origin/main'], w);
    }
  } finally { F.done(); }
});
