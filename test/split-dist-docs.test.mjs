// The overlay's package-docs area: at R, supervisor.md's sync steps carry the pin, code-style.md's
// L-SEC-6 carries the kit's own package as its one exception, and the area's README holds R's adoption
// message. The split tool generates a tree at this checkout's HEAD with every overlay area on it; each
// doc in the tree differs from HEAD's by one insertion into its named paragraph, and nothing else.
//
// Regular work never waits on the overlay (a stale overlay item is carried over by hand, never by
// failing regular work), so two kinds of drift at HEAD skip, naming what drifted, and nothing else does:
//   - the split itself stops at HEAD on manifest drift (exit 1, nothing written, every line one of
//     split-tool's drift kinds, copied below; its H tests name it). Any other stop, a malformed
//     overlay (exit 2) or a crash still fails.
//   - a patch no longer applies AND HEAD no longer has its pre-image, the paragraph with one line each
//     side as the patch was written (PRE pins that pre-image's SHA-256). That patch's checks skip as a
//     carry-over: regenerate the patch and its PRE hash. The recipe: insert the text into the paragraph
//     in a copy of the doc, `git diff --no-index -U1` the two copies, write the headers as
//     `--- a/<path>` and `+++ b/<path>`, and set PRE to the SHA-256 of the patch's context and removed
//     lines joined by newlines. A patch that fails against text HEAD still has fails; every patch is
//     checked, and its pre-image must hash to PRE (D1).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const AREA = 'package-docs';
const areaDir = path.join(root, 'test', 'split', 'overlay', AREA);
const SUP = 'docs/devteam/process/supervisor.md';
const CODE = 'docs/devteam/governance/code-style.md';
// each patched doc: its patch, the line its paragraph starts with, and the SHA-256 of the patch's
// pre-image (that line with one line each side, as the doc had them when the patch was written)
const PRE = {
  [SUP]: { patch: 'supervisor-sync.patch', para: '- **Find.** ', sha256: '10c9fccea0e9fcc044fc6566e8c5d5b3e63801c8971d068d09fe75dd37378b48' },
  [CODE]: { patch: 'code-style-l-sec-6.patch', para: '- **Supply chain:** ', sha256: 'f96f72362469133f3ff76e50f3ce5395a271c35dbee1e72c1ad3a14f08e2d4d2' },
};
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(GIT_|DEVTEAM_)/.test(k)));
const run = (cmd, args, o = {}) => spawnSync(cmd, args, { encoding: 'utf8', env, maxBuffer: 1 << 28, ...o });
const sha256 = (t) => crypto.createHash('sha256').update(t).digest('hex');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'split-dist-docs-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const head = run('git', ['-C', root, 'rev-parse', 'HEAD']).stdout.trim();
const atHead = (f) => run('git', ['-C', root, 'show', `${head}:${f}`]).stdout;
const out = path.join(tmp, 'tree');
const split = run(process.execPath, [path.join(root, 'test', 'split', 'split.mjs'), '--at', head, '--out', out, '--json'], { cwd: tmp });
let report = null;
try { report = JSON.parse(split.stdout); } catch { /* D1 names it */ }
const inTree = (f) => fs.readFileSync(path.join(out, f), 'utf8');

// split-tool's drift kinds (test/split-tool.test.mjs, DRIFT), the only stops that skip
const SPLIT_DRIFT_KINDS = [/^split: manifest\.json: manifest: module .+ (?:is not in the source|starts at line \d+, not after .+|must start at line 1)$/,
  /^split: manifest\.json: module .+ is \d+ lines, over the cap of \d+$/, /^split: manifest\.json: the declaration at line \d+ .* binds names the split can't read whole/,
  /^split: nothing written$/];
const splitLines = split.stderr.trim().split('\n').filter(Boolean);
const SPLIT_DRIFT = split.status === 1 && splitLines.length > 0 && splitLines.every((l) => SPLIT_DRIFT_KINDS.some((re) => re.test(l)))
  ? `HEAD's split stopped on manifest drift, so no tree to check (split-tool's H tests name it): ${splitLines.slice(0, 2).join('; ')}` : false;
// A patch's pre-image: its context and removed lines, as the doc had them when it was written. PRE pins
// its SHA-256, so a patch edited or regenerated without its hash is caught (D1), and drift is judged
// only for the patch as pinned.
function preImage(file) {
  const text = fs.readFileSync(path.join(areaDir, 'patches', PRE[file].patch), 'utf8');
  const body = text.split('\n').slice(text.split('\n').findIndex((l) => l.startsWith('@@')) + 1);
  return body.filter((l) => l.startsWith(' ') || l.startsWith('-')).map((l) => l.slice(1)).join('\n');
}
// a doc whose pinned patch no longer applies because HEAD no longer has its pre-image: the reason its
// checks skip. A patch that isn't the pinned one, or that fails against text HEAD still has, isn't drift.
function drift(file) {
  if (!report?.overlay?.stale?.some((x) => x.area === AREA && x.kind === 'patch' && x.name === PRE[file].patch)) return false;
  const pre = preImage(file);
  if (sha256(pre) !== PRE[file].sha256) return false;
  if (`\n${atHead(file)}\n`.includes(`\n${pre}\n`)) return false;
  return `carry-over: ${PRE[file].patch} no longer applies, because ${file}'s paragraph ${PRE[file].para.trim()} or a line beside it changed at HEAD; regenerate the patch and its PRE hash`;
}
const DRIFT = { [SUP]: drift(SUP), [CODE]: drift(CODE) };

// The one paragraph (line) that differs, and what was inserted into it: the doc's lines are equal
// except one, and that one is the old line with a single run of text added.
function insertion(file) {
  const para = PRE[file].para;
  const was = atHead(file).split('\n');
  const now = inTree(file).split('\n');
  assert.equal(now.length, was.length, `${file}: the tree's copy has ${now.length} lines, HEAD's ${was.length}`);
  const differ = was.map((l, i) => (l === now[i] ? -1 : i)).filter((i) => i >= 0);
  assert.equal(differ.length, 1, `${file}: ${differ.length} lines differ (${differ.map((i) => i + 1).join(', ')}), not one paragraph`);
  const [i] = differ;
  assert.ok(was[i].startsWith(para), `${file}: line ${i + 1} differs, not the paragraph ${para}`);
  const a = was[i];
  const b = now[i];
  let p = 0;
  while (p < a.length && a[p] === b[p]) p++;
  let s = 0;
  while (s < a.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  assert.equal(p + s, a.length, `${file}: the paragraph's own words changed, not only an insertion`);
  return b.slice(p, b.length - s);
}

test('D1: the area applies to a tree generated at HEAD, its patches applied and none stale or in conflict', { skip: SPLIT_DRIFT }, () => {
  assert.equal(split.status, 0, `split exited ${split.status}: ${split.stderr}`);
  assert.ok(report?.overlay, `split --json printed no overlay report: ${split.stdout.slice(0, 200)}`);
  const ov = report.overlay;
  assert.ok(ov.areas.includes(AREA), `the overlay has no ${AREA} area: ${ov.areas.join(', ')}`);
  const want = [CODE, SUP].filter((f) => !DRIFT[f]);
  const applied = ov.applied.filter((a) => a.area === AREA && a.kind === 'patch').flatMap((a) => a.sites).filter((f) => want.includes(f)).sort();
  assert.deepEqual(applied, want, `${AREA}'s patches applied to: ${applied.join(', ') || 'nothing'}`);
  // every patch is the one PRE pins: a regenerated or edited patch comes with its new hash, or a later
  // break against unchanged text would read as drift
  for (const f of [CODE, SUP]) {
    const h = sha256(preImage(f));
    assert.equal(h, PRE[f].sha256, `${PRE[f].patch}'s pre-image hashes ${h}, not its PRE hash in this test; a regenerated patch needs its new PRE hash`);
  }
  const stale = ov.stale.filter((x) => x.area === AREA && ![SUP, CODE].some((f) => DRIFT[f] && x.name === PRE[f].patch));
  assert.deepEqual(stale, [], `${AREA} is stale: ${stale.map((x) => `${x.name}: ${x.why}`).join('; ')}`);
  const conflicts = ov.conflicts.filter((c) => c.areas.includes(AREA) || /supervisor\.md|code-style\.md/.test(c.name));
  assert.deepEqual(conflicts, [], `conflicts: ${conflicts.map((c) => c.why).join('; ')}`);
  const ignored = ov.ignored.filter((x) => x.startsWith(`overlay/${AREA}/`));
  assert.deepEqual(ignored, [], `files the split doesn't read in ${AREA}: ${ignored.join(', ')}`);
});

test("D2: supervisor.md's sync steps gain the pin, and nothing else in supervisor.md changes", { skip: SPLIT_DRIFT || DRIFT[SUP] }, () => {
  const added = insertion(SUP);
  for (const w of ['A sync is the copy plus the pin', '`chore start devteam-sync-<tag>` writes it', '`devteam.mjs package pin <tag>`', 'replaced `docs/devteam/`', 'another tag', 'The pin is required', 'verified']) {
    assert.ok(added.includes(w), `the sync steps' insertion doesn't say ${w}: ${added}`);
  }
});

test("D3: code-style.md's L-SEC-6 gains the kit's own package as its one exception, and nothing else in code-style.md changes", { skip: SPLIT_DRIFT || DRIFT[CODE] }, () => {
  const added = insertion(CODE);
  for (const w of ['one exception', "the kit's own package", 'pinned by the devteam sync', 'verified by `merge`', "installed at the release's age"]) {
    assert.ok(added.includes(w), `L-SEC-6's insertion doesn't say ${w}: ${added}`);
  }
});

test("D4: the area's README holds R's adoption message, in plain words: sync R, then confirm the dashboard serves the new app", () => {
  const readme = fs.readFileSync(path.join(areaDir, 'README.md'), 'utf8');
  const at = readme.indexOf("\n## R's Migration\n");
  assert.ok(at >= 0, "the area's README has no ## R's Migration section");
  const rest = readme.slice(at + 1).split('\n').slice(1);
  const end = rest.findIndex((l) => /^#{1,2} /.test(l));
  const msg = (end < 0 ? rest : rest.slice(0, end)).join('\n').trim();
  assert.match(msg, /1\. Sync this release/, 'the message does not start with syncing R');
  assert.match(msg, /2\. Then open your project's dashboard and confirm it shows the new app/, 'the message does not then confirm the dashboard serves the new app');
  // plain words (R2): no code, commands, flags, paths or ids
  assert.doesNotMatch(msg, /`|--|\b[a-z]+\.(?:mjs|md|json)\b|\b(?:[mqatk]|kit)-\d|\/[a-z]/, `the message is not in plain words: ${msg}`);
});
