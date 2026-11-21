// merge lands exactly the main it checked (kit-332): a main that moves between merge's checks and
// its landing is refused, and nothing lands; with main unmoved, the same merge lands as before.
// Each test is a fixture with bare origins; a gate, which runs after the checks and before the
// landing, moves main by pointing it at a commit parked on origin as "advance". Run with TMUX unset:
// no fixture here starts or stops a tmux server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { multiFixture, write, json, review, kit, REAL_GIT } from './lib/kit.mjs';
import { readyInHome, recordsFixture } from './lib/multirepo-home-fixture.mjs';

const SUP = { DEVTEAM_ROLE: 'supervisor' };
const MOVED = /main moved since the checks \([0-9a-f]{12} to [0-9a-f]{12}\); run merge again/;
const VERIF = '| Done-when | Command | Result |\n|---|---|---|\n| s | t | pass |\n';

// A gate that moves the branch of the bare origin at `bare` to its "advance" branch, then fetches it
// into the merging clone at `clone`, as another session sharing that clone's refs would (spec-1 F1):
// a landing that re-read the clone's origin/<main> would then find the moved main. A no-op once main
// is already there, so a second merge runs the same gate with main unmoved.
const mover = (bare, branch, clone) => `git --git-dir='${bare}' update-ref refs/heads/${branch} refs/heads/advance && git -C '${clone}' fetch -q origin ${branch}`;
// One commit on top of origin's `branch`, parked on origin as "advance"; returns its sha.
function park(F, bare, branch, file) {
  const other = path.join(F.base, `advance-${path.basename(bare)}`);
  F.g(['clone', '-q', '-b', branch, bare, other], F.base);
  write(path.join(other, file), 'moved\n');
  F.g(['add', '-A'], other);
  F.g(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'main moves'], other);
  F.g(['push', '-q', 'origin', 'HEAD:refs/heads/advance'], other);
  return F.g(['rev-parse', 'HEAD'], other);
}
// A ticket ready to merge, its records with its code: work, spec, plan, verification, then a final
// review at the head; pushed from a worktree of `co` based on origin's `branch`.
function ready(F, id, co, branch, files, extra = {}) {
  F.ticket(id, { touches: Object.keys(files).map((f) => `${f.split('/')[0]}/**`), ...extra });
  const w = path.join(F.old, '.worktrees', id);
  F.g(['worktree', 'add', '-q', '-b', `ticket/${id}`, w, `origin/${branch}`], co);
  const tdir = path.join(w, `docs/devteam/project/tickets/${id}`);
  write(path.join(tdir, 'spec.md'), '# spec\n');
  write(path.join(tdir, 'plan.md'), '# plan\n\n## TL;DR\n\n- x\n');
  write(path.join(tdir, 'verification.md'), VERIF);
  for (const [f, text] of Object.entries(files)) write(path.join(w, f), text);
  F.g(['add', '-A'], w); F.g(['commit', '-qm', `${id}: work`], w);
  write(path.join(tdir, 'reviews/final-1.md'), review('reviewer-b', F.g(['rev-parse', 'HEAD'], w)));
  F.g(['add', '-A'], w); F.g(['commit', '-qm', 'review'], w); F.g(['push', '-q', 'origin', `ticket/${id}`], w);
  F.okIn(F.old, ['act', '--class', 'approve-spec', '--refs', id, '--', 'ok'], SUP);
  F.okIn(F.old, ['act', '--class', 'approve-plan', '--refs', id, '--', 'ok'], SUP);
  write(path.join(F.old, `docs/devteam/run/pr/ticket/${id}.md`), `# ${id}: work\n\n## One-way doors\n\nNone.\n`);
  return F.g(['rev-parse', 'HEAD'], w);
}
const tipOf = (F, co, branch) => { F.g(['fetch', '-q', 'origin'], co); return F.g(['rev-parse', `origin/${branch}`], co); };
const parentsOf = (F, co, sha) => F.g(['rev-list', '--parents', '-n', '1', sha], co).split(' ').slice(1);
const mergeActs = (F, id) => json(F.okIn(F.old, ['log', '--type', 'act', '--json'])).filter((a) => a.class === 'merge-word' && (a.refs ?? []).includes(id));
const landedOn = (F, co, sha, branch) => { try { F.g(['merge-base', '--is-ancestor', sha, `origin/${branch}`], co); return true; } catch { return false; } };
// console's gates, replaced: links.console.gates = { test: cmd }, plus any other link keys
function consoleLink(F, gates, extra = {}) {
  const links = json(F.okIn(F.old, ['settings'])).links;
  F.lines({ ...F.STD, console: { link: 'console' }, companion: { link: 'companion' } }, { links: { ...links, console: { ...links.console, gates, ...extra } } });
}

test('a linked repo\'s ticket, forge git: main moves after the checks, so the merge is refused and nothing lands; run again with main unmoved, it lands onto that main', () => {
  const F = multiFixture('kit332-linked-git');
  const id = 'console-01-a';
  try {
    consoleLink(F, { test: mover(F.consoleOrigin, 'trunk', F.console) });
    const sha = ready(F, id, F.console, 'trunk', { 'src/main.js': 'changed\n' });
    const checked = tipOf(F, F.console, 'trunk');
    const adv = park(F, F.consoleOrigin, 'trunk', 'package.json');
    const r = F.runIn(F.old, ['merge', id], SUP);
    assert.notEqual(r.status, 0, r.out);
    assert.match(r.err, MOVED);
    assert.match(r.err, new RegExp(`\\(${checked.slice(0, 12)} to ${adv.slice(0, 12)}\\)`), 'it names the main it checked and the one it found');
    assert.equal(tipOf(F, F.console, 'trunk'), adv, 'main is as the mover left it');
    assert.equal(landedOn(F, F.console, sha, 'trunk'), false, 'the head did not land');
    assert.deepEqual(mergeActs(F, id), [], 'no merge act');
    // the same merge again: the gate leaves main where it is now, so it lands, onto exactly that main
    assert.match(F.okIn(F.old, ['merge', id], SUP), new RegExp(`merged ticket/${id} at ${sha.slice(0, 12)} in console`));
    const tip = tipOf(F, F.console, 'trunk');
    assert.deepEqual(parentsOf(F, F.console, tip), [adv, sha], 'one merge of the head onto the main it checked');
    assert.equal(mergeActs(F, id).length, 1);
    // C7: the code's landing is cmdMerge's own (landCode, inside it); the records' landing is
    // landRecords, a part of its own outside cmdMerge, as the ticket's touches name them
    const src = fs.readFileSync(path.join(kit, 'scripts', 'devteam.mjs'), 'utf8');
    const start = src.indexOf('\nfunction cmdMerge() {');
    assert.ok(start >= 0, 'cmdMerge is a top-level function');
    const end = src.indexOf('\nfunction ', start + 1);
    assert.ok(src.slice(start, end).includes('const landCode = () =>'), 'landCode is inside cmdMerge');
    const lr = src.search(/^function landRecords\(/m);
    assert.ok(lr >= 0 && lr < start, 'landRecords is a top-level function before cmdMerge, outside it');
  } finally { F.done(); }
});

test('a linked repo\'s ticket, forge github: main moves after the checks, so the merge is refused before gh pr merge; unmoved, gh pr merge runs at the head', () => {
  const F = multiFixture('kit332-linked-gh');
  const id = 'console-01-a';
  try {
    consoleLink(F, { test: mover(F.consoleOrigin, 'trunk', F.console) }, { forge: 'github' });
    const sha = ready(F, id, F.console, 'trunk', { 'src/main.js': 'changed\n' });
    // a gh first on PATH: pr view answers one open, clean PR at the head; pr merge is only logged
    const bin = path.join(F.base, 'bin-gh');
    const log = path.join(F.base, 'gh.log');
    const prFile = path.join(F.base, 'pr.json');
    write(path.join(bin, 'gh'), `#!/bin/sh\necho "$@" >> "${log}"\n[ "$1 $2" = "pr view" ] && exec cat "${prFile}"\n[ "$1 $2" = "pr merge" ] && exit 0\nexit 1\n`);
    fs.chmodSync(path.join(bin, 'gh'), 0o755);
    write(prFile, JSON.stringify({ number: 7, headRefOid: sha, title: `${id}: work`, body: '## One-way doors\n\nNone.\n', isDraft: false, mergeStateStatus: 'CLEAN', url: 'https://example.test/pr/7', statusCheckRollup: [] }));
    const env = { PATH: `${bin}${path.delimiter}${process.env.PATH}` };
    const prMerges = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter((c) => c.startsWith('pr merge ')) : []);
    const checked = tipOf(F, F.console, 'trunk');
    const adv = park(F, F.consoleOrigin, 'trunk', 'package.json');
    const r = F.runIn(F.old, ['merge', id], SUP, env);
    assert.notEqual(r.status, 0, r.out);
    assert.match(r.err, MOVED);
    assert.match(r.err, new RegExp(`\\(${checked.slice(0, 12)} to ${adv.slice(0, 12)}\\)`), 'it names the main it checked and the one it found');
    assert.deepEqual(prMerges(), [], 'gh pr merge was never called');
    assert.equal(tipOf(F, F.console, 'trunk'), adv, 'main is as the mover left it');
    assert.deepEqual(mergeActs(F, id), [], 'no merge act');
    // again, main unmoved: gh pr merge runs, pinned to the head
    assert.match(F.okIn(F.old, ['merge', id], SUP, env), new RegExp(`merged ticket/${id} at ${sha.slice(0, 12)} in console`));
    assert.equal(prMerges().length, 1);
    assert.match(prMerges()[0], new RegExp(`^pr merge 7 --merge --match-head-commit ${sha}( |$)`));
  } finally { F.done(); }
});

test('a home ticket, forge git: home\'s main moves after the checks, so the merge is refused and nothing lands; run again with main unmoved, it lands onto that main', () => {
  const F = multiFixture('kit332-home');
  const id = 'api-01-a';
  try {
    const homeOrigin = F.g(['config', '--get', 'remote.origin.url'], F.old);
    F.lines({ ...F.STD, console: { link: 'console' }, companion: { link: 'companion' } }, { gates: { test: { cmd: mover(homeOrigin, 'main', F.old) } } });
    const sha = ready(F, id, F.old, 'main', { 'api/x.js': 'x\n' });
    const checked = tipOf(F, F.old, 'main');
    const adv = park(F, homeOrigin, 'main', 'api/moved.txt');
    const r = F.runIn(F.old, ['merge', id], SUP);
    assert.notEqual(r.status, 0, r.out);
    assert.match(r.err, MOVED);
    assert.match(r.err, new RegExp(`\\(${checked.slice(0, 12)} to ${adv.slice(0, 12)}\\)`));
    assert.equal(tipOf(F, F.old, 'main'), adv, 'main is as the mover left it');
    assert.equal(landedOn(F, F.old, sha, 'main'), false, 'the head did not land');
    assert.deepEqual(mergeActs(F, id), [], 'no merge act');
    assert.match(F.okIn(F.old, ['merge', id], SUP), new RegExp(`merged ticket/${id} at ${sha.slice(0, 12)}`));
    assert.deepEqual(parentsOf(F, F.old, tipOf(F, F.old, 'main')), [adv, sha], 'one merge of the head onto the main it checked');
    assert.equal(mergeActs(F, id).length, 1);
  } finally { F.done(); }
});

test('records in home: they land, then the code is refused because main moved; the message says so, the code is not on main, and merge again lands only the code', () => {
  const F = recordsFixture('kit332-records');
  const id = 'console-01-a';
  try {
    consoleLink(F, { test: mover(F.consoleOrigin, 'trunk', F.console) }, { records: 'home' });
    const r0 = readyInHome(F, id);
    const checked = tipOf(F, F.console, 'trunk');
    const adv = park(F, F.consoleOrigin, 'trunk', 'package.json');
    const half = F.runIn(F.old, ['merge', id], SUP);
    assert.notEqual(half.status, 0, half.out);
    assert.match(half.err, new RegExp(`the records of ${id} landed in home at ${r0.head.slice(0, 12)}; the code did not land in console \\(main moved since the checks \\(${checked.slice(0, 12)} to ${adv.slice(0, 12)}\\); run merge again\\): run merge ${id} again`));
    assert.equal(tipOf(F, F.console, 'trunk'), adv, 'main is as the mover left it');
    assert.equal(landedOn(F, F.console, r0.code, 'trunk'), false, 'the code did not land');
    assert.deepEqual(mergeActs(F, id), [], 'no merge act');
    const again = F.okIn(F.old, ['merge', id], SUP);
    assert.match(again, new RegExp(`merged ticket/${id} at ${r0.code.slice(0, 12)} in console`));
    assert.doesNotMatch(again, /landed the records/, 'the records landed once');
    assert.deepEqual(parentsOf(F, F.console, tipOf(F, F.console, 'trunk')), [adv, r0.code]);
    assert.equal(mergeActs(F, id).length, 1);
  } finally { F.done(); }
});


// The records merges logged for a ticket: merge's own act for the records of <id> in home.
const recordsActs = (F, id) => json(F.okIn(F.old, ['log', '--type', 'act', '--json'])).filter((a) => a.class === 'merge-word' && String(a.what).startsWith(`merged home's ticket/${id} at `));

test('records in home, home forge git: home\'s main moves after the checks, before the records land: refused with the moved words, and neither the records nor the code lands; merge again lands both', () => {
  const F = recordsFixture('kit332-records-home');
  const id = 'console-01-a';
  try {
    const homeOrigin = F.g(['config', '--get', 'remote.origin.url'], F.old);
    // console's gate moves home's main (where the records land), not console's
    consoleLink(F, { test: mover(homeOrigin, 'main', F.old) }, { records: 'home' });
    const r0 = readyInHome(F, id);
    const checked = tipOf(F, F.old, 'main');
    const trunk = tipOf(F, F.console, 'trunk');
    const adv = park(F, homeOrigin, 'main', 'api/moved.txt');
    const r = F.runIn(F.old, ['merge', id], SUP);
    assert.notEqual(r.status, 0, r.out);
    assert.match(r.err, new RegExp(`the records of ${id} did not land in home \\(push to home's main refused: home's main moved since the checks \\(${checked.slice(0, 12)} to ${adv.slice(0, 12)}\\); run merge again\\); nothing landed: verify from the start`));
    assert.equal(tipOf(F, F.old, 'main'), adv, 'home\'s main is as the mover left it');
    assert.equal(landedOn(F, F.old, r0.head, 'main'), false, 'the records did not land');
    assert.equal(tipOf(F, F.console, 'trunk'), trunk, 'console\'s main is unchanged: the code did not land');
    assert.deepEqual(recordsActs(F, id), [], 'no records act');
    assert.deepEqual(mergeActs(F, id), [], 'no merge act');
    // again, home's main unmoved: the records land onto it, then the code
    assert.match(F.okIn(F.old, ['merge', id], SUP), new RegExp(`merged ticket/${id} at ${r0.code.slice(0, 12)} in console`));
    assert.deepEqual(parentsOf(F, F.old, tipOf(F, F.old, 'main')), [adv, r0.head], 'the records merged onto the main they were checked on');
    assert.equal(recordsActs(F, id).length, 1);
    assert.equal(mergeActs(F, id).length, 1);
  } finally { F.done(); }
});

// Records in home with home on forge github and console on forge git: a gh first on PATH answers
// home's records PR (pr list: none merged; pr view: one open, clean PR #9 at the records head) and
// only logs pr merge, so the records PR's merge never moves home's main.
function recordsOnGithub(F, id, gate) {
  const links = json(F.okIn(F.old, ['settings'])).links;
  F.lines({ ...F.STD, console: { link: 'console' }, companion: { link: 'companion' } }, { forge: 'github', links: { ...links, console: { ...links.console, records: 'home', forge: 'git', gates: { test: gate } } } });
  const r0 = readyInHome(F, id);
  const bin = path.join(F.base, 'bin-gh');
  const log = path.join(F.base, 'gh.log');
  const prFile = path.join(F.base, 'pr.json');
  write(prFile, JSON.stringify({ number: 9, headRefOid: r0.head, isDraft: false, mergeStateStatus: 'CLEAN', state: 'OPEN', statusCheckRollup: [] }));
  write(path.join(bin, 'gh'), `#!/bin/sh\necho "$@" >> "${log}"\n[ "$1 $2" = "pr list" ] && { echo '[]'; exit 0; }\n[ "$1 $2" = "pr view" ] && exec cat "${prFile}"\n[ "$1 $2" = "pr merge" ] && exit 0\nexit 1\n`);
  fs.chmodSync(path.join(bin, 'gh'), 0o755);
  const prMerges = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter((c) => c.startsWith('pr merge ')) : []);
  return { r0, bin, prMerges };
}

test('records in home, home forge github: home\'s main moves after the checks, so the records PR is not merged; unmoved, it merges once and the code lands', () => {
  const F = recordsFixture('kit332-records-gh');
  const id = 'console-01-a';
  try {
    const homeOrigin = F.g(['config', '--get', 'remote.origin.url'], F.old);
    const { r0, bin, prMerges } = recordsOnGithub(F, id, mover(homeOrigin, 'main', F.old));
    const env = { PATH: `${bin}${path.delimiter}${process.env.PATH}` };
    const checked = tipOf(F, F.old, 'main');
    const trunk = tipOf(F, F.console, 'trunk');
    const adv = park(F, homeOrigin, 'main', 'api/moved.txt');
    const r = F.runIn(F.old, ['merge', id], SUP, env);
    assert.notEqual(r.status, 0, r.out);
    assert.match(r.err, new RegExp(`the records of ${id} did not land in home \\(home's main moved since the checks \\(${checked.slice(0, 12)} to ${adv.slice(0, 12)}\\); run merge again\\); nothing landed: verify from the start`));
    assert.deepEqual(prMerges(), [], 'the records PR was never merged');
    assert.equal(tipOf(F, F.old, 'main'), adv, 'home\'s main is as the mover left it');
    assert.deepEqual(recordsActs(F, id), [], 'no records act');
    assert.deepEqual(mergeActs(F, id), [], 'no merge act');
    assert.equal(tipOf(F, F.console, 'trunk'), trunk, 'the code did not land');
    // again, home's main unmoved (the stand-in's pr merge moves nothing, so the gate is a no-op)
    assert.match(F.okIn(F.old, ['merge', id], SUP, env), new RegExp(`merged ticket/${id} at ${r0.code.slice(0, 12)} in console`));
    assert.equal(prMerges().length, 1);
    assert.match(prMerges()[0], new RegExp(`^pr merge 9 --merge --match-head-commit ${r0.head}( |$)`));
    assert.equal(landedOn(F, F.console, r0.code, 'trunk'), true, 'the code landed');
    assert.equal(mergeActs(F, id).length, 1);
  } finally { F.done(); }
});

test('records in home, home forge github: the re-check can\'t fetch home\'s main, so the records PR is not merged', () => {
  const F = recordsFixture('kit332-records-gh-nofetch');
  const id = 'console-01-a';
  try {
    // the gate drops a marker; from then on a git first on PATH fails every fetch
    const marker = path.join(F.base, 'fetches-fail');
    const shim = path.join(F.base, 'git-fetch-fails');
    write(path.join(shim, 'git'), `#!/bin/sh\nif [ -f "${marker}" ]; then case " $* " in *" fetch "*) echo "fatal: the test's fetch fails" >&2; exit 128 ;; esac; fi\nexec "${REAL_GIT}" "$@"\n`);
    fs.chmodSync(path.join(shim, 'git'), 0o755);
    const { bin, prMerges } = recordsOnGithub(F, id, `touch '${marker}'`);
    const trunk = tipOf(F, F.console, 'trunk');
    const r = F.runIn(F.old, ['merge', id], SUP, { PATH: `${shim}${path.delimiter}${bin}${path.delimiter}${process.env.PATH}` });
    assert.notEqual(r.status, 0, r.out);
    assert.ok(fs.existsSync(marker), 'the gate ran');
    assert.match(r.err, new RegExp(`the records of ${id} did not land in home \\(couldn't fetch home's main to check it hasn't moved since the checks; run merge again\\); nothing landed: verify from the start`));
    assert.deepEqual(prMerges(), [], 'the records PR was never merged');
    assert.deepEqual(recordsActs(F, id), [], 'no records act');
    assert.equal(tipOf(F, F.console, 'trunk'), trunk, 'the code did not land');
  } finally { F.done(); }
});
