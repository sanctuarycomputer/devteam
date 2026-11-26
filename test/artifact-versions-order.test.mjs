// An artifact's versions in one list (kit-947): one entry per distinct page content, keyed by its
// fingerprint, ordered strictly by time, newest first, each dated by the change that made it; a
// draft that only copies main's landed or an earlier version is no version and no Library draft.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { threadsFixture, write } from './lib/kit.mjs';
import { cleanup } from './lib/chrome.mjs';
import { CHROME, versOn, cardTitle, frameIs, LIST_OPEN, OPTS, VERS, VERS_WT } from './lib/dashboard-library-fixture.mjs';

const ARTIFACTS_REL = 'docs/devteam/project/artifacts';
const ISO = (d) => new Date(d).toISOString();
const page = (n) => ({
  'artifact.json': JSON.stringify({ v: 1, title: 'Order mock', summary: 'A page with versions', by: 'supervisor', for: [] }),
  'index.html': `<!doctype html><html><body><p>v${n}</p></body></html>`,
});
// git in a folder, its commit dated `when` (author and committer), as a commit made then
const gitAt = (cwd, when, args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { cwd, encoding: 'utf8', env: { ...process.env, ...(when ? { GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when } : {}) } }).trim();
const putIn = (dir, files) => { for (const [rel, text] of Object.entries(files)) write(path.join(dir, rel), text); };
// every file's mtime set, as a fresh checkout or an edit sets it
const touchAll = (dir, when) => { for (const f of fs.readdirSync(dir)) fs.utimesSync(path.join(dir, f), when, when); };
// an artifact landed on main at a date: its tree and commit
function landAt(F, slug, files, when) {
  const dir = path.join(F.old, ARTIFACTS_REL, slug);
  fs.rmSync(dir, { recursive: true, force: true });
  putIn(dir, files);
  gitAt(F.old, when, ['add', '-A', dir]);
  gitAt(F.old, when, ['commit', '-qm', `artifact: ${slug} at ${when}`]);
  gitAt(F.old, null, ['push', '-q', 'origin', 'main']);
  return { tree: gitAt(F.old, null, ['rev-parse', `HEAD:${ARTIFACTS_REL}/${slug}`]), commit: gitAt(F.old, null, ['rev-parse', 'HEAD']), when };
}
const wtDir = (F, name, slug) => path.join(F.old, '.worktrees', name, ARTIFACTS_REL, slug);
// a worktree that is its own git checkout, the artifact committed at `when`, its files touched now
function draftAt(F, name, slug, files, when) {
  const root = path.join(F.old, '.worktrees', name);
  putIn(wtDir(F, name, slug), files);
  if (!fs.existsSync(path.join(root, '.git'))) gitAt(root, null, ['init', '-q']);
  gitAt(root, when, ['add', '-A']);
  gitAt(root, when, ['commit', '-qm', `draft at ${when}`]);
  touchAll(wtDir(F, name, slug), new Date());
  return root;
}
// a plain folder under .worktrees/ (no checkout of its own) holding a copy
const plainCopy = (F, name, slug, files) => putIn(wtDir(F, name, slug), files);
const versions = (F, slug) => JSON.parse(F.owner(['artifact', 'versions', slug, '--json'])).versions;
// run/cache's tree fingerprints, {} when there is no such file
const treeFps = (F) => { try { return JSON.parse(fs.readFileSync(path.join(F.old, 'docs/devteam/run/cache/artifact-tree-fps.json'), 'utf8')); } catch { return {}; } };
const nonIncreasing = (vs) => vs.every((v, i) => i === 0 || Date.parse(vs[i - 1].time) >= Date.parse(v.time));

test('one list, strictly by time, newest first, whatever the kind', (t) => {
  const F = threadsFixture('order-o1');
  cleanup(t)(() => F.done());
  const v1 = landAt(F, 'order-mock', page(1), '2026-01-01T00:00:00Z');
  const v2 = landAt(F, 'order-mock', page(2), '2026-03-01T00:00:00Z');
  // a draft whose page last changed between the two, its files touched now (a fresh checkout)
  draftAt(F, 'demo-01-draft', 'order-mock', page('d'), '2026-02-01T00:00:00Z');
  const vs = versions(F, 'order-mock');
  assert.deepEqual(vs.map((v) => [v.kind, v.kind === 'draft' ? v.at : v.commit]), [['landed', v2.commit], ['draft', 'demo-01-draft'], ['earlier', v1.commit]], 'O1: landed (March), the draft (February), earlier (January)');
  assert.ok(nonIncreasing(vs), 'O1: newest first');
});

test('times compare as instants, not text: a commit in another time zone sorts by when it was made', (t) => {
  const F = threadsFixture('order-o1b');
  cleanup(t)(() => F.done());
  const v1 = landAt(F, 'order-mock', page(1), '2026-01-01T00:00:00Z');
  // 03:00 at +05:00 is 22:00 UTC the day before: older than the draft, though its text sorts after
  const v2 = landAt(F, 'order-mock', page(2), '2026-02-01T03:00:00+05:00');
  assert.match(gitAt(F.old, null, ['log', '-1', '--format=%cI', v2.commit]), /\+05:00$/, 'git keeps the offset');
  draftAt(F, 'demo-01-draft', 'order-mock', page('d'), '2026-02-01T00:00:00Z');
  const vs = versions(F, 'order-mock');
  assert.deepEqual(vs.map((v) => [v.kind, v.kind === 'draft' ? v.at : v.commit]), [['draft', 'demo-01-draft'], ['landed', v2.commit], ['earlier', v1.commit]], 'O1b: the draft (00:00Z) above landed (22:00Z the day before)');
});

test('A -> B -> A on main: one A entry, landed, dated by its first commit', (t) => {
  const F = threadsFixture('order-o2');
  cleanup(t)(() => F.done());
  const A1 = landAt(F, 'order-mock', page('A'), '2026-01-01T00:00:00Z');
  const B = landAt(F, 'order-mock', page('B'), '2026-02-01T00:00:00Z');
  const A2 = landAt(F, 'order-mock', page('A'), '2026-03-01T00:00:00Z');
  assert.equal(A2.tree, A1.tree, 'the same files, the same tree');
  const vs = versions(F, 'order-mock');
  assert.deepEqual(vs.map((v) => [v.kind, v.tree, v.commit, Date.parse(v.time)]), [['earlier', B.tree, B.commit, Date.parse(B.when)], ['landed', A1.tree, A1.commit, Date.parse(A1.when)]], 'O2: B, then A landed at its first commit');
});

test('landed is chosen by fingerprint: A back on main under another tree id (a mode change) is the one landed A', (t) => {
  const F = threadsFixture('order-landed-fp');
  cleanup(t)(() => F.done());
  const A1 = landAt(F, 'order-mock', page('A'), '2026-01-01T00:00:00Z');
  const B = landAt(F, 'order-mock', page('B'), '2026-02-01T00:00:00Z');
  // A's bytes again, index.html executable: the same fingerprint (paths and blobs), another tree id
  const dir = path.join(F.old, ARTIFACTS_REL, 'order-mock');
  fs.rmSync(dir, { recursive: true, force: true });
  putIn(dir, page('A'));
  fs.chmodSync(path.join(dir, 'index.html'), 0o755);
  gitAt(F.old, '2026-03-01T00:00:00Z', ['add', '-A', dir]);
  gitAt(F.old, '2026-03-01T00:00:00Z', ['commit', '-qm', 'order-mock: A, executable']);
  gitAt(F.old, null, ['push', '-q', 'origin', 'main']);
  const now = gitAt(F.old, null, ['rev-parse', `HEAD:${ARTIFACTS_REL}/order-mock`]);
  assert.notEqual(now, A1.tree, 'another tree id');
  const vs = versions(F, 'order-mock');
  assert.deepEqual(vs.map((v) => [v.kind, v.tree, v.commit]), [['earlier', B.tree, B.commit], ['landed', now, A1.commit]], 'one A entry, landed (main\'s tree now), at A\'s first commit');
});

test('a draft is dated by committer time, not author time (a rebased page is dated by its rebase)', (t) => {
  const F = threadsFixture('order-committer');
  cleanup(t)(() => F.done());
  landAt(F, 'order-mock', page(1), '2026-01-01T00:00:00Z');
  const root = path.join(F.old, '.worktrees', 'demo-08-rebased');
  putIn(wtDir(F, 'demo-08-rebased', 'order-mock'), page('rebased'));
  gitAt(root, null, ['init', '-q']);
  gitAt(root, null, ['add', '-A']);
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-qm', 'rebased'], { cwd: root, env: { ...process.env, GIT_AUTHOR_DATE: '2026-02-10T00:00:00Z', GIT_COMMITTER_DATE: '2026-04-01T00:00:00Z' } });
  touchAll(wtDir(F, 'demo-08-rebased', 'order-mock'), new Date());
  const d = versions(F, 'order-mock').find((v) => v.kind === 'draft');
  assert.equal(d?.time, ISO('2026-04-01T00:00:00Z'), 'the committer time (April), not the author time (February)');
});

test('each entry carries its fingerprint, describe\'s, and a main tree\'s is kept in run/cache by tree id', (t) => {
  const F = threadsFixture('order-o3');
  cleanup(t)(() => F.done());
  const v1 = landAt(F, 'order-mock', page(1), '2026-01-01T00:00:00Z');
  const v2 = landAt(F, 'order-mock', page(2), '2026-02-01T00:00:00Z');
  const fpOf = (at) => JSON.parse(F.owner(['artifact', 'describe', 'order-mock', '--at', at, '--json'])).fp;
  const vs = versions(F, 'order-mock');
  assert.deepEqual(vs.map((v) => v.fp), [fpOf(`tree:${v2.tree}`), fpOf(`tree:${v1.tree}`)], 'O3: each main entry\'s fp is describe\'s for its tree');
  const kept = treeFps(F);
  assert.deepEqual([kept[v2.tree], kept[v1.tree]], [vs[0].fp, vs[1].fp], 'O3b: kept in run/cache by tree id');
});

test('byte-identical copies collapse: one entry per content, at the copy made first; none for a copy of main\'s', (t) => {
  const F = threadsFixture('order-o4');
  cleanup(t)(() => F.done());
  const B = landAt(F, 'order-mock', page('B'), '2026-01-01T00:00:00Z');
  const A = landAt(F, 'order-mock', page('A'), '2026-02-01T00:00:00Z');
  // two worktrees hold B (an earlier main version), one holds A (landed), two hold the same new page D
  plainCopy(F, 'demo-02-b', 'order-mock', page('B'));
  draftAt(F, 'demo-03-b', 'order-mock', page('B'), '2026-04-01T00:00:00Z');
  plainCopy(F, 'demo-04-a', 'order-mock', page('A'));
  draftAt(F, 'demo-05-d', 'order-mock', page('D'), '2026-04-10T00:00:00Z');
  draftAt(F, 'demo-06-d', 'order-mock', page('D'), '2026-04-05T00:00:00Z');
  const vs = versions(F, 'order-mock');
  assert.deepEqual(vs.map((v) => [v.kind, v.at, Date.parse(v.time)]), [['draft', 'demo-06-d', Date.parse('2026-04-05T00:00:00Z')], ['landed', `tree:${A.tree}`, Date.parse(A.when)], ['earlier', `tree:${B.tree}`, Date.parse(B.when)]], 'O4: one D entry, at the copy made first; no entry for a copy of B or A');
});

test('a worktree draft is dated by its page\'s own last change, never the branch head', (t) => {
  const F = threadsFixture('order-o5');
  cleanup(t)(() => F.done());
  landAt(F, 'order-mock', page(1), '2026-01-01T00:00:00Z');
  // the page committed in February, an unrelated file in April (the head), every file touched now
  const root = draftAt(F, 'demo-01-draft', 'order-mock', page('d'), '2026-02-10T00:00:00Z');
  write(path.join(root, 'other.txt'), 'not the artifact');
  gitAt(root, '2026-04-01T00:00:00Z', ['add', 'other.txt']);
  gitAt(root, '2026-04-01T00:00:00Z', ['commit', '-qm', 'unrelated']);
  const dir = wtDir(F, 'demo-01-draft', 'order-mock');
  touchAll(dir, new Date());
  let d = versions(F, 'order-mock').find((v) => v.kind === 'draft');
  assert.equal(d.time, ISO('2026-02-10T00:00:00Z'), 'O5: the commit that changed the folder, not the head (April) nor the files\' time (now)');
  // uncommitted changes there: the folder's newest file time
  write(path.join(dir, 'index.html'), 'edited, not committed');
  touchAll(dir, new Date('2026-05-01T00:00:00Z'));
  fs.utimesSync(path.join(dir, 'index.html'), new Date('2026-05-03T00:00:00Z'), new Date('2026-05-03T00:00:00Z'));
  d = versions(F, 'order-mock').find((v) => v.kind === 'draft');
  assert.equal(d.time, ISO('2026-05-03T00:00:00Z'), 'O6: uncommitted, the newest file time');
});

// a branch fetched from another machine (refs/devteam-remote/, kit-750): far-mock added at `page`,
// then the tip changes something else at `tip`; its tip sha
function remoteBranch(F, branch, base, pageAt, tipAt) {
  const side = path.join(path.dirname(F.old), 'order-side');
  gitAt(F.old, null, ['worktree', 'add', '-q', '-b', 'order-side', side, base]);
  putIn(path.join(side, ARTIFACTS_REL, 'far-mock'), page('far'));
  gitAt(side, pageAt, ['add', '-A']);
  gitAt(side, pageAt, ['commit', '-qm', 'far-mock']);
  write(path.join(side, 'other.txt'), 'later, not the artifact');
  gitAt(side, tipAt, ['add', '-A']);
  gitAt(side, tipAt, ['commit', '-qm', 'unrelated']);
  const tip = gitAt(side, null, ['rev-parse', 'HEAD']);
  gitAt(F.old, null, ['update-ref', `refs/devteam-remote/${branch}`, tip]);
  gitAt(F.old, null, ['worktree', 'remove', '--force', side]);
  gitAt(F.old, null, ['branch', '-qD', 'order-side']);
  return tip;
}

test('a branch draft from another machine is dated by its folder\'s last change, not its tip', (t) => {
  const F = threadsFixture('order-o7');
  cleanup(t)(() => F.done());
  const v1 = landAt(F, 'order-mock', page(1), '2026-01-01T00:00:00Z');
  const tip = remoteBranch(F, 'ticket/far-02', v1.commit, '2026-03-01T00:00:00Z', '2026-05-01T00:00:00Z');
  const r = versions(F, 'far-mock').find((v) => v.at === 'origin:ticket/far-02');
  assert.deepEqual([r?.time, r?.commit], [ISO('2026-03-01T00:00:00Z'), tip], 'O7: dated by the commit that changed far-mock, still served from the tip');
});

test('21 worktrees holding main\'s or an older main copy and one real draft: the draft and main\'s versions', (t) => {
  const F = threadsFixture('order-o8');
  cleanup(t)(() => F.done());
  const v1 = landAt(F, 'order-mock', page(1), '2026-01-01T00:00:00Z');
  const v2 = landAt(F, 'order-mock', page(2), '2026-02-01T00:00:00Z');
  for (let i = 1; i <= 21; i++) plainCopy(F, `kit-${100 + i}-other`, 'order-mock', page(i % 2 ? 1 : 2));
  plainCopy(F, 'kit-200-real', 'order-mock', page('real'));
  const vs = versions(F, 'order-mock');
  assert.deepEqual(vs.map((v) => [v.kind, v.kind === 'draft' ? v.at : v.commit]), [['draft', 'kit-200-real'], ['landed', v2.commit], ['earlier', v1.commit]], 'O8: the real draft and main\'s two versions');
});

test('the Library lists no copy of main\'s landed or an earlier version as a draft', (t) => {
  const F = threadsFixture('order-o9');
  cleanup(t)(() => F.done());
  landAt(F, 'order-mock', page(1), '2026-01-01T00:00:00Z');
  landAt(F, 'order-mock', page(2), '2026-02-01T00:00:00Z');
  plainCopy(F, 'kit-101-old', 'order-mock', page(1));
  plainCopy(F, 'kit-102-landed', 'order-mock', page(2));
  plainCopy(F, 'kit-103-real', 'order-mock', page('real'));
  // dashboard-data is the child each /api/data build runs (the dashboard's dashboardData)
  const lib = JSON.parse(F.owner(['dashboard-data'])).library.artifacts.filter((a) => a.slug === 'order-mock');
  assert.deepEqual(lib.map((a) => a.at).sort(), ['kit-103-real', 'main'], 'O9: the Library row opens main; no Draft row for a stale copy');
});

test('main moving refreshes the drop: a copy listed while main lacks it goes once main has had it', (t) => {
  const F = threadsFixture('order-moved');
  cleanup(t)(() => F.done());
  landAt(F, 'order-mock', page(1), '2026-01-01T00:00:00Z');
  plainCopy(F, 'kit-101-x', 'order-mock', page('X'));
  const rows = () => JSON.parse(F.owner(['dashboard-data'])).library.artifacts.filter((a) => a.slug === 'order-mock').map((a) => a.at).sort();
  assert.deepEqual(rows(), ['kit-101-x', 'main'], 'X is a draft while main never had it');
  // main lands X, then Y: X is an earlier version now, not landed
  landAt(F, 'order-mock', page('X'), '2026-02-01T00:00:00Z');
  landAt(F, 'order-mock', page('Y'), '2026-03-01T00:00:00Z');
  assert.deepEqual(rows(), ['main'], 'main moved: the copy of its earlier X is no draft');
});

test('a branch from another machine holding a copy of an earlier main version is no draft, even under another tree id', (t) => {
  const F = threadsFixture('order-remote-copy');
  cleanup(t)(() => F.done());
  landAt(F, 'order-mock', page(1), '2026-01-01T00:00:00Z');
  const v2 = landAt(F, 'order-mock', page(2), '2026-02-01T00:00:00Z');
  // v1's bytes with index.html executable: the same fingerprint (paths and blobs), another tree id
  const side = path.join(path.dirname(F.old), 'order-copy');
  gitAt(F.old, null, ['worktree', 'add', '-q', '-b', 'order-copy', side, v2.commit]);
  const dir = path.join(side, ARTIFACTS_REL, 'order-mock');
  putIn(dir, page(1));
  fs.chmodSync(path.join(dir, 'index.html'), 0o755);
  gitAt(side, '2026-03-01T00:00:00Z', ['add', '-A']);
  gitAt(side, '2026-03-01T00:00:00Z', ['commit', '-qm', 'order-mock back to v1, executable']);
  const tip = gitAt(side, null, ['rev-parse', 'HEAD']);
  gitAt(F.old, null, ['update-ref', 'refs/devteam-remote/ticket/copy-01', tip]);
  gitAt(F.old, null, ['worktree', 'remove', '--force', side]);
  gitAt(F.old, null, ['branch', '-qD', 'order-copy']);
  const v1tree = gitAt(F.old, null, ['rev-parse', `HEAD~1:${ARTIFACTS_REL}/order-mock`]);
  assert.notEqual(gitAt(F.old, null, ['rev-parse', `${tip}:${ARTIFACTS_REL}/order-mock`]), v1tree, 'another tree id');
  const lib = JSON.parse(F.owner(['dashboard-data'])).library.artifacts.filter((a) => a.slug === 'order-mock').map((a) => a.at);
  assert.deepEqual(lib, ['main'], 'the branch copy of v1 is no draft');
});

// git on PATH writing each call's arguments to a file: run(args) runs devteam.mjs through it and
// gives its output and the git calls it made
function gitSpy(F) {
  const bin = path.join(path.dirname(F.old), 'order-bin');
  const calls = path.join(path.dirname(F.old), 'order-git-calls.txt');
  const real = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
  write(path.join(bin, 'git'), `#!/bin/sh\nprintf '%s\\n' "$*" >> '${calls}'\nexec '${real}' "$@"\n`);
  fs.chmodSync(path.join(bin, 'git'), 0o755);
  const env = { PATH: `${bin}${path.delimiter}${process.env.PATH}` };
  return (args) => { fs.writeFileSync(calls, ''); const out = F.owner(args, env); return { out, calls: fs.readFileSync(calls, 'utf8').split('\n').filter(Boolean) }; };
}

test('the drop is kept in run/cache: a second dashboard-data read runs no git log or ls-tree -r for it', (t) => {
  const F = threadsFixture('order-o10');
  cleanup(t)(() => F.done());
  const v1 = landAt(F, 'order-mock', page(1), '2026-01-01T00:00:00Z');
  const v2 = landAt(F, 'order-mock', page(2), '2026-02-01T00:00:00Z');
  plainCopy(F, 'kit-101-other', 'order-mock', page(1));
  plainCopy(F, 'kit-102-real', 'order-mock', page('real'));
  remoteBranch(F, 'ticket/far-02', v1.commit, '2026-03-01T00:00:00Z', '2026-05-01T00:00:00Z');
  draftAt(F, 'kit-103-checkout', 'order-mock', page('checkout'), '2026-03-05T00:00:00Z');
  const run = gitSpy(F);
  const first = run(['dashboard-data']);
  assert.ok(first.calls.length > 0, 'the wrapper saw git');
  assert.equal(typeof treeFps(F)[v2.tree], 'string', 'O10: main\'s tree fingerprint kept by tree id after a Library read');
  const second = run(['dashboard-data']);
  // the drop's git: a log of an artifact's folder, or a recursive ls-tree of a tree id or an artifact
  // (dashboard-data runs other recursive ls-trees, of the kit's own files, every time)
  const lsR = (c) => /^ls-tree\b/.test(c) && /\s-[a-z]*r[a-z]*(\s|$)/.test(c) && (/\s[0-9a-f]{40,64}(\s|$)/.test(c) || c.includes(ARTIFACTS_REL));
  const forDrop = second.calls.filter((c) => (/^log\b/.test(c) && c.includes(ARTIFACTS_REL)) || lsR(c));
  assert.deepEqual(forDrop, [], 'O11: nothing changed, no git log or ls-tree -r for the drop');
  assert.deepEqual(JSON.parse(second.out).library.artifacts.filter((a) => a.slug === 'order-mock').map((a) => a.at).sort(), ['kit-102-real', 'kit-103-checkout', 'main'], 'O11: the same drop, from the cache');
});

test('a draft\'s last-change time is kept by its head: a second versions read runs no one-commit git log', (t) => {
  const F = threadsFixture('order-o12');
  cleanup(t)(() => F.done());
  const v1 = landAt(F, 'order-mock', page(1), '2026-01-01T00:00:00Z');
  remoteBranch(F, 'ticket/far-02', v1.commit, '2026-03-01T00:00:00Z', '2026-05-01T00:00:00Z');
  draftAt(F, 'kit-103-checkout', 'order-mock', page('checkout'), '2026-03-05T00:00:00Z');
  const run = gitSpy(F);
  // the branch tip's, and the clean checkout's HEAD's
  const one = (c) => /^log\b/.test(c) && /(^|\s)(-1|-n\s?1|--max-count[=\s]1)(\s|$)/.test(c);
  for (const slug of ['far-mock', 'order-mock']) {
    const firstRead = run(['artifact', 'versions', slug, '--json']);
    assert.ok(firstRead.calls.some(one), `${slug}: the first read asks git for the folder's last change`);
    const again = run(['artifact', 'versions', slug, '--json']);
    assert.deepEqual(again.calls.filter(one), [], `O12: ${slug}: no one-commit git log on a second versions read with nothing changed`);
  }
});

test('the cap keeps landed: A, 200 other pages, then A again', (t) => {
  const F = threadsFixture('order-cap');
  cleanup(t)(() => F.done());
  const dir = path.join(F.old, ARTIFACTS_REL, 'cap-mock');
  const at = (i) => new Date(Date.UTC(2026, 0, 1) + i * 3600 * 1000).toISOString();
  // one push at the end: 202 commits, each an hour after the last
  const commit = (n, i) => { fs.rmSync(dir, { recursive: true, force: true }); putIn(dir, page(n)); gitAt(F.old, at(i), ['add', '-A', dir]); gitAt(F.old, at(i), ['commit', '-qm', `cap-mock ${n}`]); };
  commit('A', 0);
  for (let i = 1; i <= 200; i++) commit(`x${i}`, i);
  commit('A', 201);
  gitAt(F.old, null, ['push', '-q', 'origin', 'main']);
  const r = JSON.parse(F.owner(['artifact', 'versions', 'cap-mock', '--json']));
  assert.equal(r.versions.length, 200);
  assert.equal(r.truncated, true);
  assert.deepEqual([r.versions.at(-1).kind, Date.parse(r.versions.at(-1).time)], ['landed', Date.parse(at(0))], 'landed, dated by its first commit, kept at the end');
  assert.ok(nonIncreasing(r.versions), 'newest first');
  assert.equal(r.versions[0].time.slice(0, 13), at(200).slice(0, 13), 'the newest other page first');
});

test('a draft whose checkout ignores its folder is dated by its files\' time', (t) => {
  const F = threadsFixture('order-ignored');
  cleanup(t)(() => F.done());
  landAt(F, 'order-mock', page(1), '2026-01-01T00:00:00Z');
  const root = path.join(F.old, '.worktrees', 'demo-07-ignored');
  write(path.join(root, 'other.txt'), 'not the artifact');
  gitAt(root, null, ['init', '-q']);
  gitAt(root, '2026-04-01T00:00:00Z', ['add', 'other.txt']);
  gitAt(root, '2026-04-01T00:00:00Z', ['commit', '-qm', 'unrelated']);
  write(path.join(root, '.git/info/exclude'), 'docs/\n');
  putIn(wtDir(F, 'demo-07-ignored', 'order-mock'), page('ignored'));
  touchAll(wtDir(F, 'demo-07-ignored', 'order-mock'), new Date('2026-06-01T00:00:00Z'));
  const d = versions(F, 'order-mock').find((v) => v.kind === 'draft');
  assert.equal(d?.time, ISO('2026-06-01T00:00:00Z'), 'a clean status and no commit for the folder: its files\' newest time');
});

test('the viewer\'s version list: each entry\'s date, drafts included', { ...CHROME, timeout: 300000 }, async (t) => {
  const { p, soon, go, made } = await versOn(t);
  await go('#library');
  await soon(`!!document.querySelector(${JSON.stringify(cardTitle(VERS))})`, 'the card');
  await p.click(cardTitle(VERS));
  await soon(frameIs(`/artifact/wt/${VERS_WT}/${VERS}/`), 'the draft in the viewer');
  await p.click('#av-ver');
  await soon(`${LIST_OPEN} && ${OPTS}.length === ${made.versions.length}`, 'the versions listed');
  const opts = await p.ev(OPTS);
  const days = await p.ev(`${JSON.stringify(made.versions.map((v) => v.time))}.map((t) => new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }))`);
  assert.equal(opts[0].text, `Draft · live in ${VERS_WT} · ${days[0]}`, 'O13: the draft with its date');
  for (const [i, o] of opts.entries()) assert.ok(o.text.includes(days[i]), `O13: ${o.text} has its date ${days[i]}`);
});

test('the viewer\'s version list: newest at the top, a draft older than main\'s below it', { ...CHROME, timeout: 300000 }, async (t) => {
  const { p, soon, go, made } = await versOn(t);
  // the draft's files an hour older than main's three commits
  touchAll(made.draft, new Date(Date.now() - 3600 * 1000));
  const [, landed, mid, oldest] = made.versions;
  await go('#library');
  await soon(`!!document.querySelector(${JSON.stringify(cardTitle(VERS))})`, 'the card');
  await p.click(cardTitle(VERS));
  await soon(frameIs(`/artifact/wt/${VERS_WT}/${VERS}/`), 'the draft in the viewer');
  await p.click('#av-ver');
  await soon(`${LIST_OPEN} && ${OPTS}.length === ${made.versions.length}`, 'the versions listed');
  assert.deepEqual((await p.ev(OPTS)).map((o) => o.at), ['main', mid.at, oldest.at, VERS_WT], 'O14: by time, the hour-old draft last');
  assert.equal(landed.kind, 'landed');
});
