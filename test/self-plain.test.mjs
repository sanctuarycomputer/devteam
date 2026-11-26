// kit-862: project/self.md as a plain document (log.schema.json#self2). The kit's reader is a port of
// test/fixtures/world2/check.mjs (the self-plain region), so every world2 self case gets its result
// alone and through self check, check-pr and chore pr; a version 1 file on main validates, fails no
// PR and raises one self-drift asking for the plain version; a plain one raises self-drift once per
// part path gone; the names hold reads the whole text; self show prints the document and its data is
// null. Each check is named as in the spec's acceptance table (P1…).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { json, kit as KIT, write } from './lib/kit.mjs';
import { fixture, SUP } from './lib/next-step-fixture.mjs';
import { checkSelf as refCheckSelf, version as refVersion, selfHeld as refSelfHeld, namesWhole as refNamesWhole } from './fixtures/world2/check.mjs';

const P = 'docs/devteam/project';
const SELF = `${P}/self.md`;
const STRAT = `${P}/strategy.md`;
const world = (f) => fs.readFileSync(new URL(`./fixtures/world/${f}`, import.meta.url), 'utf8');
const world2 = (f) => fs.readFileSync(new URL(`./fixtures/world2/${f}`, import.meta.url), 'utf8');
// version 1's self.md, with a prose link to a path main lacks: a version 1 file is never read for part links (final-1 F2)
const V1 = world('self.md').replace('It controls its code', 'An old part was [the old app](../gone/).\n\nIt controls its code');
const V1_PARTS = { 'app/main.js': 'app\n', 'app/plugins/api.js': 'api\n', 'sync/server.js': 'sync\n', 'deploy/sync.yml': 'deploy\n' };
const W2 = JSON.parse(world2('cases.json'));
const CASES = W2.cases.filter((c) => c.doc === 'self');
// cases.json's root is docs/project; the fixture's project is docs/devteam/project, so its docs/x is docs/devteam/x
const PARTS = Object.fromEntries(W2.paths.map((p) => [`docs/devteam/${p.slice('docs/'.length)}`, 'x\n']));
const SELF_MD = world2('self.md');
const STRATEGY = world2('strategy.md');
const SRC = fs.readFileSync(path.join(KIT, 'scripts', 'devteam.mjs'), 'utf8');

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

test('P1 the kit\'s plain self checker, run alone, gives each world2 self case its result', async (t) => {
  await t.test('P1 the self-plain region gives every case its errors and parts', () => {
    const region = SRC.match(/\/\* self-plain start \*\/([\s\S]*?)\/\* self-plain end \*\//)?.[1];
    assert.ok(region, 'P1 devteam.mjs has a self-plain region');
    const { selfPlainCheck } = vm.runInContext(`${region}\n;({ selfPlainCheck })`, vm.createContext({ path }));
    const has = (p) => p === '' || W2.paths.some((f) => f === p || f.startsWith(`${p}/`));
    for (const c of CASES) {
      const got = selfPlainCheck(world2(c.file), { root: W2.root, has });
      assert.equal(got.errors.length, c.expect.errors.length, `P1 ${c.file}: ${JSON.stringify(got.errors)}`);
      c.expect.errors.forEach((w, i) => assert.ok(got.errors[i].includes(w), `P1 ${c.file}: "${got.errors[i]}" names "${w}"`));
      assert.deepEqual(JSON.parse(JSON.stringify(got.parts)), c.expect.parts, `P1 ${c.file} parts`);
      assert.deepEqual(JSON.parse(JSON.stringify(got)), refCheckSelf(world2(c.file), { root: W2.root, has }), `P1 ${c.file}: word for word the reference checker's`);
    }
  });
  await t.test('P1 selfPlainVersion agrees with the reference on every case and on version 1\'s fixtures', () => {
    const region = SRC.match(/\/\* self-plain start \*\/([\s\S]*?)\/\* self-plain end \*\//)?.[1] ?? '';
    const { selfPlainVersion } = vm.runInContext(`${region}\n;({ selfPlainVersion })`, vm.createContext({ path }));
    for (const text of [...CASES.map((c) => world2(c.file)), world('self.md'), world('exterior.md'), world('exterior-empty.md')]) assert.equal(selfPlainVersion(text), refVersion(text));
  });
  await t.test('P1b the region declares only selfPlain, selfPlainVersion and selfPlainCheck at top level, none of them elsewhere', () => {
    const region = SRC.match(/\/\* self-plain start \*\/([\s\S]*?)\/\* self-plain end \*\//)?.[1] ?? '';
    const top = [...region.matchAll(/^(?:const|let|var|function) ([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
    assert.deepEqual(top, ['selfPlain', 'selfPlainVersion', 'selfPlainCheck'], 'P1b its top-level names');
    const rest = SRC.replace(region, '');
    for (const n of top) assert.doesNotMatch(rest, new RegExp(`^(?:const|let|var|function) ${n}\\b`, 'm'), `P1b ${n} is declared once`);
  });
});

test('P5 one function judges the draft for self check, chore pr and check-pr', async (t) => {
  await t.test('P5 one function, selfDraftErrors, in the self-model region, judges the draft for self check, chore pr and check-pr', () => {
    assert.equal((SRC.match(/\nfunction selfDraftErrors\(/g) ?? []).length, 1, 'P5 selfDraftErrors is defined once');
    const model = SRC.slice(SRC.indexOf('/* self-model start */'), SRC.indexOf('/* self-model end */'));
    assert.match(model, /\nfunction selfDraftErrors\(/, 'P5 selfDraftErrors is in the self-model region');
    const body = (name) => SRC.match(new RegExp(`\\nfunction ${name}\\([\\s\\S]*?\\n}\\n`))?.[0] ?? '';
    for (const f of ['choreSelfHold', 'selfDraftLines', 'cmdSelf']) assert.match(body(f), /selfDraftErrors\(/, `P5 ${f} calls selfDraftErrors`);
  });
});

test('Q a version 1 self.md on main validates, fails no PR, and raises one self-drift asking for the plain version; a plain one clears it', withProject('q-v1', { self: V1, files: { ...PARTS, ...V1_PARTS } }, async (W, check) => {
  await check('Q1 validate passes with a version 1 self.md', () => {
    const v = W.run(['validate']);
    assert.doesNotMatch(v.out, /self\.md/, `Q1 validate says nothing of self.md\n${v.out}`);
  });
  await check('Q1b validate refuses a self block the version 1 reader cannot see (a ~~~ fence) as a plain document does', () => {
    write(path.join(W.old, SELF), V1.replace('```self', '~~~self').replace(/\n```\n/, '\n~~~\n'));
    const v = W.run(['validate']);
    W.g(['checkout', '--', SELF], W.old);
    assert.notEqual(v.status, 0, `Q1b validate refuses it\n${v.text}`);
    assert.match(v.out, /self\.md: self\.md holds a fenced self block at line \d+: a plain document has none/, `Q1b says why\n${v.out}`);
  });
  await check('Q2 a PR not changing self.md passes check-pr', () => {
    const sha = W.branchOf('chore-note', (w) => write(path.join(w, `${P}/designs/n.md`), 'n\n'));
    const r = W.checkPr('chore-note', sha);
    assert.equal(r.status, 0, `Q2 check-pr passes\n${r.text}`);
  });
  await check('Q3 self check refuses the version 1 file as a draft', () => {
    const r = W.run(['self', 'check']);
    assert.equal(r.status, 1, `Q3 self check refuses it\n${r.out}`);
    assert.match(r.out, /error: self\.md: .*fenced self block/, `Q3 naming the block\n${r.out}`);
  });
  await check('Q4 one self-drift, keyed self@1, asking for the plain version; none per path, even with a part\'s path gone', () => {
    W.onMain({ sync: null }, 'a version 1 part\'s path goes');
    const f = W.findings('self-drift');
    assert.deepEqual(f.map((x) => [x.severity, x.subject, x.key]), [['low', 'self', 'self@1']], `Q4 one self-drift\n${JSON.stringify(f)}`);
    assert.match(f[0].detail, /version 1/, 'Q4 the detail says version 1');
    assert.match(f[0].suggestion, /plain/, 'Q4 the suggestion asks for the plain version');
  });
  await check('Q6 self show prints the version 1 document as it is, exit 0', () => {
    const s = W.run(['self', 'show']);
    assert.equal(s.status, 0, `Q6 exit 0\n${s.text}`);
    assert.ok(s.out.includes(V1.trim()), `Q6 the whole document\n${s.out}`);
  });
  await check('Q5 a plain self.md on main clears it', () => {
    W.onMain({ [SELF]: SELF_MD }, 'the plain version');
    assert.deepEqual(W.findings('self-drift'), [], 'Q5 no self-drift');
  });
}));

test('R a plain self.md on main: self-drift once per part link gone, never for a link that is no part', withProject('r-drift', { self: `${SELF_MD}\nIts [notes](notes.md), [the guide](#guide), \`[old](../old/)\` and ![logo](../logo/) are no parts, and [the app again](../app/#top) is one.\n` }, async (W, check) => {
  await check('R1 a refactor deleting two parts\' folders passes check-pr, and validate says nothing of self.md', () => {
    assert.deepEqual(W.findings('self-drift'), [], 'R1 none while every part is on main');
    const gone = { 'docs/devteam/app': null, 'docs/devteam/plugin api': null };
    const sha = W.branchOf('chore-refactor', (w) => { for (const p of Object.keys(gone)) fs.rmSync(path.join(w, p), { recursive: true, force: true }); write(path.join(w, 'docs/devteam/web/main.js'), 'moved\n'); });
    const k = W.checkPr('chore-refactor', sha);
    W.onMain({ ...gone, 'docs/devteam/web/main.js': 'moved\n' }, 'refactor');
    assert.equal(k.status, 0, `R1 the refactor passes check-pr\n${k.text}`);
    assert.doesNotMatch(W.run(['validate']).out, /self\.md/, 'R1 validate says nothing of self.md');
  });
  await check('R2 metrics raises self-drift once per part path gone, keyed by it, and never for a link that is no part', () => {
    const f = W.findings('self-drift');
    assert.deepEqual(f.map((x) => [x.severity, x.subject, x.key]).sort(), [['low', 'self', 'docs/devteam/app'], ['low', 'self', 'docs/devteam/plugin api/index.js']], `R2 once per path\n${JSON.stringify(f)}`);
    assert.deepEqual(f.map((x) => x.detail).sort(), ['part link ../app/ points to nothing on main', 'part link ../plugin%20api/index.js#top points to nothing on main'], `R2 the detail names the link as written (spec What changes 4)\n${JSON.stringify(f)}`);
  });
  await check('R3 observe-metrics records one observation per path', () => {
    W.ok(['observe-metrics']);
    const keys = logLines(W).filter((o) => o.type === 'observation' && o.kind === 'self-drift').map((o) => o.source_key).sort();
    assert.deepEqual(keys, ['metrics:self-drift:self:docs/devteam/app', 'metrics:self-drift:self:docs/devteam/plugin api/index.js'], `R3\n${JSON.stringify(keys)}`);
  });
}));

test('S the names hold reads the whole plain text; self show prints it; its data is null', withProject('s-plain', {}, async (W, check) => {
  const marked = SELF_MD.replace('It controls its code', 'It mails through Postwick, and `Zephyr` runs it.\n\n```\nrun Brightline\n```\n\n<!-- see Vellum -->\n\n## The Kestrel part\n\n- a Corvid list item\n\nIts [Heron](../app/) link.\n\nIt controls its code');
  await check('S1 self check passes a plain draft', () => {
    write(path.join(W.old, SELF), marked);
    const c = W.run(['self', 'check']);
    W.g(['checkout', '--', SELF], W.old);
    assert.equal(c.status, 0, `S1 the plain draft passes\n${c.text}`);
  });
  await check('S1b self check warns on every capitalised word the draft holds, code, comments, headings, lists and links included', () => {
    write(path.join(W.old, SELF), marked);
    const c = W.run(['self', 'check']);
    W.g(['checkout', '--', SELF], W.old);
    const warned = [...c.out.matchAll(/warning: self\.md: "([^"]+)" \(prose\)/g)].map((m) => m[1]);
    assert.deepEqual(warned, ['Postwick', 'Zephyr', 'Brightline', 'Vellum', 'Kestrel', 'Corvid', 'Heron'], `S1b each word once, in order\n${c.out}`);
  });
  await check('S2 on a public repo chore pr holds a plain draft until each word is named, then pushes it', () => {
    W.setVisibility('public');
    const a = W.chorePr('names', (w) => write(path.join(w, SELF), SELF_MD.replace('It controls its code', 'It mails through Postwick.\n\nIt controls its code')));
    assert.notEqual(a.status, 0, `S2 held\n${a.text}`);
    assert.match(a.text, /"Postwick" \(prose\)/, 'S2 naming the word');
    const b = W.chorePr('names', () => {}, ['--names-checked', 'Postwick']);
    assert.equal(b.status, 0, `S2 --names-checked Postwick pushes it\n${b.text}`);
    W.setVisibility('private');
  });
  await check('S3 self show prints main\'s document as it is', () => {
    const s = W.run(['self', 'show']);
    assert.equal(s.status, 0, `S3 exit 0\n${s.text}`);
    assert.ok(s.out.includes(SELF_MD.trim()), `S3 the whole document\n${s.out}`);
  });
  await check('S4 self show --json and dashboard-data\'s self are null for a plain self.md', () => {
    const j = W.run(['self', 'show', '--json']);
    assert.equal(j.out, 'null', `S4 self show --json is null\n${j.text}`);
  });
  await check('S4b dashboard-data\'s self is null for a plain self.md', () => {
    assert.equal(json(W.ok(['dashboard-data'])).self, null, 'S4b dashboard-data self is null');
  });
  await check('S1c an existing part\'s link target is held like any word', () => {
    write(path.join(W.old, 'docs/devteam/Kestrelbox/x'), 'x\n');
    write(path.join(W.old, SELF), SELF_MD.replace('It controls its code', 'Its [sync service](../Kestrelbox/) keeps notes alike.\n\nIt controls its code'));
    const c = W.run(['self', 'check']);
    W.g(['checkout', '--', SELF], W.old);
    fs.rmSync(path.join(W.old, 'docs/devteam/Kestrelbox'), { recursive: true, force: true });
    assert.equal(c.status, 0, `S1c the draft passes\n${c.text}`);
    assert.match(c.out, /warning: self\.md: "Kestrelbox" \(prose\)/, `S1c Kestrelbox is held\n${c.out}`);
  });
  await check('S5 the page reads no self key of dashboard-data', () => {
    const page = fs.readFileSync(path.join(KIT, 'dashboard', 'index.html'), 'utf8');
    assert.doesNotMatch(page, /\b(?:d|data)\.self\b/, 'S5 index.html reads no data.self');
  });
  await check('H HELP_OBSERVE says self show prints the document and self check checks self@2', () => {
    const help = SRC.match(/const HELP_OBSERVE = `([\s\S]*?)`;/)?.[1] ?? '';
    const lines = help.split('\n').filter((l) => /^ {2}self (show|check)\b/.test(l));
    assert.equal(lines.length, 2, `H two self lines\n${lines.join('\n')}`);
    assert.doesNotMatch(lines.join('\n'), /self@1|parts with their paths/, 'H no version 1 words');
    assert.match(lines[0], /self show .*as it is/, 'H self show prints the document');
    assert.match(lines[1], /self check .*self@2/, 'H self check names self@2');
  });
}));

// The self-plain region's selfHeld, run alone.
const regionHeld = () => {
  const region = SRC.match(/\/\* self-plain start \*\/([\s\S]*?)\/\* self-plain end \*\//)?.[1] ?? '';
  return vm.runInContext(`${region}\n;({ held: selfPlain.selfHeld })`, vm.createContext({ path })).held;
};
test('N the names hold reads a heading (# or setext), a list item, a quote, a table row, the words in [ ], code, a comment and a marked first word whole; only a bare prose sentence\'s first word is skipped (final-1b F1, kit-926)', withProject('names', {}, async (W, check) => {
  await check('N1 nineteen names cases', () => assert.equal(W2.names.length, 19, 'N1 nineteen names cases'));
  for (const c of W2.names) {
    await check(`N1 the reference and the self-plain region give ${c.file} its words (${c.shows})`, () => {
      assert.deepEqual(refSelfHeld(world2(c.file)), c.words, `N1 the reference on ${c.file}`);
      const held = regionHeld();
      assert.equal(typeof held, 'function', 'N1 the region has selfHeld');
      assert.deepEqual(JSON.parse(JSON.stringify(held(world2(c.file)))), c.words, `N1 the region on ${c.file}`);
    });
  }
  for (const c of W2.names) {
    await check(`N2 self check warns, in order, on the words of ${c.file} that main's strategy lacks`, () => {
      write(path.join(W.old, SELF), world2(c.file));
      const r = W.run(['self', 'check']);
      W.g(['checkout', '--', SELF], W.old);
      assert.equal(r.status, 0, `N2 ${c.file} passes\n${r.text}`);
      const warned = [...r.out.matchAll(/warning: self\.md: "([^"]+)" \(prose\)/g)].map((m) => m[1]);
      const want = c.words.filter((w) => !refNamesWhole(STRATEGY, w));
      assert.ok(want.length > 0, `N2 ${c.file} names a word the strategy lacks`);
      assert.deepEqual(warned, want, `N2 ${c.file}\n${r.out}`);
    });
  }
  await check('N3 the self-plain region\'s selfHeld is check.mjs\'s, line for line (two spaces in, no export)', () => {
    const ref = fs.readFileSync(new URL('./fixtures/world2/check.mjs', import.meta.url), 'utf8').match(/\nexport function selfHeld\(text\) \{\n[\s\S]*?\n\}\n/)?.[0];
    const region = SRC.match(/\n {2}function selfHeld\(text\) \{\n[\s\S]*?\n {2}\}\n/)?.[0];
    assert.ok(ref && region, 'N3 both have selfHeld');
    assert.equal(region.split('\n').map((l) => l.replace(/^ {2}/, '')).join('\n'), ref.replace('\nexport ', '\n'), 'N3 the same function');
  });
  await check('N4 the self-plain region\'s selfHeld reads 40,000 nested [ then links in under 2 s (kit-862 final-3 M1)', () => {
    const held = regionHeld();
    const start = process.hrtime.bigint();
    held(`# T\n\n${'['.repeat(40000)}${'[a](b) '.repeat(40000)}\n`);
    const s = Number(process.hrtime.bigint() - start) / 1e9;
    assert.ok(s < 2, `N4 took ${s.toFixed(2)} s`);
  });
}));

// kit-926: main holds docs/devteam/out, a symlink to a folder outside the repo, docs/devteam/alias,
// one to the app's folder in it, and docs/devteam/vendor, a repo of its own. git's tree holds each
// symlink as a file, never a folder to look through, and the repo as a gitlink at most.
const LINKS = '[a](../out/), [b](../out/secretdir/), [c](../alias/), [d](../alias/guide.md), [e](../../../.git/config), [f](../../../.git/), [g](../App/), [h](../gone/), [i](../app/#top), [j](../Kestrelbox/), [k](../../../../old/), [l](notes.md), [m](../services/sync/), [n](../vendor/), [o](../vendor/x)';
const NOTHING = ['part link ../out/secretdir/ points to nothing', 'part link ../alias/guide.md points to nothing', 'part link ../../../.git/config points to nothing', 'part link ../../../.git/ points to nothing', 'part link ../App/ points to nothing', 'part link ../gone/ points to nothing', 'part link ../Kestrelbox/ points to nothing', 'part link ../../../../old/ leaves the repo', 'part link ../vendor/ points to nothing', 'part link ../vendor/x points to nothing'];
test('L self check looks for a part where the gates do: never through a symlink, never into .git or a nested repo (kit-926)', withProject('links', {}, async (W, check) => {
  write(path.join(W.base, 'outside/secretdir/x'), 'x\n');
  fs.symlinkSync(path.join(W.base, 'outside'), path.join(W.old, 'docs/devteam/out'));
  fs.symlinkSync('app', path.join(W.old, 'docs/devteam/alias'));
  const vendor = path.join(W.old, 'docs/devteam/vendor');
  write(path.join(vendor, 'x'), 'x\n');
  W.g(['init', '-q'], vendor);
  W.g(['add', 'x'], vendor);
  W.g(['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-qm', 'vendor'], vendor);
  W.onMain({}, 'symlinks and a nested repo');
  const draft = (links) => SELF_MD.replace('It controls its code', `Its other parts: ${links}.\n\nIt controls its code`);
  const selfCheck = (links) => {
    write(path.join(W.old, SELF), draft(links));
    const r = W.run(['self', 'check']);
    W.g(['checkout', '--', SELF], W.old);
    return { ...r, errors: [...r.out.matchAll(/^error: self\.md: (.*)$/gm)].map((m) => m[1]) };
  };
  await check('L1 self check refuses a part link through a symlinked folder outside the repo', () => {
    const r = selfCheck('[the vault](../out/secretdir/)');
    assert.equal(r.status, 1, `L1 refused\n${r.text}`);
    assert.deepEqual(r.errors, ['part link ../out/secretdir/ points to nothing'], `L1 why\n${r.out}`);
  });
  await check('L1b self check refuses a part link through a symlinked folder inside the repo', () => {
    const r = selfCheck('[the guide](../alias/guide.md)');
    assert.equal(r.status, 1, `L1b refused\n${r.text}`);
    assert.deepEqual(r.errors, ['part link ../alias/guide.md points to nothing'], `L1b why\n${r.out}`);
  });
  await check('L1c self check refuses a part link into a nested repo, and the nested repo itself', () => {
    const r = selfCheck('[the vendor file](../vendor/x) and [the vendor](../vendor/)');
    assert.equal(r.status, 1, `L1c refused\n${r.text}`);
    assert.deepEqual(r.errors, ['part link ../vendor/x points to nothing', 'part link ../vendor/ points to nothing'], `L1c why\n${r.out}`);
  });
  await check('L2 self check refuses a part link into .git/', () => {
    const r = selfCheck('[the config](../../../.git/config)');
    assert.equal(r.status, 1, `L2 refused\n${r.text}`);
    assert.deepEqual(r.errors, ['part link ../../../.git/config points to nothing'], `L2 why\n${r.out}`);
  });
  await check('L2b self check refuses a part link to .git itself', () => {
    const r = selfCheck('[the repo](../../../.git/)');
    assert.equal(r.status, 1, `L2b refused\n${r.text}`);
    assert.deepEqual(r.errors, ['part link ../../../.git/ points to nothing'], `L2b why\n${r.out}`);
  });
  await check('L3 self check passes a part link to a symlink itself, as git\'s tree holds it', () => {
    const r = selfCheck('[the vault](../out/) and [the alias](../alias/)');
    assert.equal(r.status, 0, `L3 passes\n${r.text}`);
  });
  await check('L4 self check, chore pr and check-pr refuse the same links, every link of these tests', () => {
    const own = selfCheck(LINKS).errors;
    const chore = W.chorePr('links', (w) => write(path.join(w, SELF), draft(LINKS)));
    const sha = W.branchOf('chore-agree', (w) => write(path.join(w, SELF), draft(LINKS)));
    const pr = W.checkPr('chore-agree', sha);
    assert.notEqual(chore.status, 0, `L4 chore pr refuses\n${chore.text}`);
    assert.notEqual(pr.status, 0, `L4 check-pr refuses\n${pr.text}`);
    const gate = (re, text) => [...text.matchAll(re)].map((m) => m[1]);
    assert.deepEqual(gate(/^(?:devteam: )?chore pr: self\.md: (.*)$/gm, chore.text), NOTHING, `L4 chore pr\n${chore.text}`);
    assert.deepEqual(gate(/self\.md breaks self@2 at [0-9a-f]+: (.*)$/gm, pr.text), NOTHING, `L4 check-pr\n${pr.text}`);
    assert.deepEqual(own, NOTHING, 'L4 self check refuses what the gates refuse');
  });
}));
test('X1 a project outside its repo: its own folder stands in for the repo', async (t) => {
  const F = fixture('x-outside');
  try {
    const out = path.join(F.base, 'outside');
    fs.cpSync(path.join(F.old, P), out, { recursive: true });
    write(path.join(out, 'strategy.md'), STRATEGY);
    write(path.join(out, 'app/x'), 'x\n');
    const doc = '# Self\n\nQuillmark is an app for long notes. Its part is [the app](app/).\n';
    write(path.join(out, 'self.md'), doc);
    const run = (args) => { const r = F.run(F.old, [...args, '--project', out], SUP); return { status: r.status, text: `${r.out}\n${r.err}`, out: r.out }; };
    await t.test('X1 validate says nothing of self.md, and self check passes a part link inside the folder', () => {
      assert.doesNotMatch(run(['validate']).text, /self\.md/, 'X1 validate says nothing of self.md');
      const c = run(['self', 'check']);
      assert.equal(c.status, 0, `X1 self check passes\n${c.text}`);
    });
    await t.test('X1 self check refuses a part link leaving the folder', () => {
      write(path.join(out, 'self.md'), doc.replace('](app/)', '](../old/)'));
      const c = run(['self', 'check']);
      assert.equal(c.status, 1, `X1 refused\n${c.text}`);
      assert.match(c.out, /error: self\.md: part link \.\.\/old\/ leaves the repo/, `X1 leaves the repo\n${c.out}`);
    });
    await t.test('X1c self check refuses a part link through a symlinked folder in the project folder, and passes one to the symlink itself (kit-926)', () => {
      write(path.join(F.base, 'elsewhere/x'), 'x\n');
      fs.symlinkSync(path.join(F.base, 'elsewhere'), path.join(out, 'linked'));
      write(path.join(out, 'self.md'), doc.replace('](app/)', '](linked/x)'));
      const c = run(['self', 'check']);
      assert.equal(c.status, 1, `X1c refused\n${c.text}`);
      assert.match(c.out, /error: self\.md: part link linked\/x points to nothing/, `X1c why\n${c.out}`);
      write(path.join(out, 'self.md'), doc.replace('](app/)', '](linked/)'));
      assert.equal(run(['self', 'check']).status, 0, 'X1c the symlink itself passes');
    });
  } finally { F.done(); }
});
