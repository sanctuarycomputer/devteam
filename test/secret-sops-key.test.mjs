// A secret posted to a SOPS file finds the repo's age key wherever the repo keeps it, and a planted
// key or file never gets the owner's value. Real sops and age; skipped where they are not installed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { fleetFixture, write } from './lib/kit.mjs';

const SUP = { DEVTEAM_ROLE: 'supervisor' };
const has = (c) => spawnSync(c, ['--version'], { stdio: 'ignore' }).status === 0;
const real = has('sops') && has('age-keygen');
if (process.env.DEVTEAM_TEST_SOPS === '1') assert.ok(real, 'DEVTEAM_TEST_SOPS=1 but sops or age-keygen is not on PATH');
const keygen = () => {
  const out = spawnSync('age-keygen', { encoding: 'utf8' }).stdout;
  return { id: out.match(/AGE-SECRET-KEY-1[0-9A-Z]+/)[0], pub: out.match(/age1[a-z0-9]+/)[0] };
};
const encrypt = (pub, file) => {
  const r = spawnSync('sops', ['-e', '-i', '--age', pub, '--input-type', 'dotenv', '--output-type', 'dotenv', file], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
};
const decrypt = (id, file) => spawnSync('sops', ['-d', '--input-type', 'dotenv', '--output-type', 'dotenv', file], { encoding: 'utf8', env: { ...process.env, SOPS_AGE_KEY: id } });

function repo(F, pub) {
  const { old, g } = F;
  write(path.join(old, 'secrets/app.enc.env'), 'SEED=1\n');
  encrypt(pub, path.join(old, 'secrets/app.enc.env'));
  fs.appendFileSync(path.join(old, '.gitignore'), 'secrets/*.dec\n');
  g(['add', '-A', 'secrets', '.gitignore'], old);
  g(['commit', '-qm', 'store'], old);
  g(['push', '-q', 'origin', 'main'], old);
}
const asks = (F, names) => F.ok(F.old, ['ask', '--kind', 'owner-action', '--question', 'Post the keys', '--secrets', JSON.stringify(names.map((name) => ({ name, sink: `sops:secrets/app.enc.env:${name}` })))], SUP);

test('the repo key is found beside wrong, plugin and linked ones, and two secrets post together', { skip: !real }, () => {
  const F = fleetFixture('sops-key');
  try {
    const good = keygen(); const other = keygen();
    repo(F, good.pub);
    const q = asks(F, ['ONE', 'TWO']);
    const body = JSON.stringify({ ONE: 'value-one-9', TWO: 'value-two-9' });
    write(path.join(F.old, 'secrets/other-age-key.dec'), `# another repo\n${other.id}\n`);
    // the right key, but with a plugin line, or through a link: neither is used
    write(path.join(F.old, 'secrets/plugin-age-key.dec'), `${good.id}\nAGE-PLUGIN-MARKER-1QQQQ\n`);
    write(path.join(F.base, 'outside.txt'), `${good.id}\n`);
    fs.symlinkSync(path.join(F.base, 'outside.txt'), path.join(F.old, 'secrets/link-age-key.dec'));
    const none = F.run(F.old, ['secret', 'post', q, '--json'], {}, body);
    assert.notEqual(none.status, 0);
    assert.match(none.out + none.err, /no usable age key for secrets\/app\.enc\.env/);
    assert.doesNotMatch(none.out + none.err, /value-(one|two)-9|AGE-SECRET-KEY/);

    write(path.join(F.old, 'secrets/sops-age-key.dec'), `# this repo\n${good.id}\n`);
    const done = F.run(F.old, ['secret', 'post', q, '--json'], {}, body);
    assert.equal(done.status, 0, done.out + done.err);
    assert.doesNotMatch(done.out + done.err, /value-(one|two)-9|AGE-SECRET-KEY/);
    const w = fs.readdirSync(path.join(F.old, '.worktrees')).find((x) => x.startsWith('chore-secret-'));
    const plain = decrypt(good.id, path.join(F.old, '.worktrees', w, 'secrets/app.enc.env'));
    assert.equal(plain.status, 0, plain.stderr);
    assert.match(plain.stdout, /ONE=value-one-9/);
    assert.match(plain.stdout, /TWO=value-two-9/);
  } finally { F.done(); }
});

test('a planted chore folder and key never receive the value', { skip: !real }, () => {
  const F = fleetFixture('sops-plant');
  try {
    const good = keygen(); const evil = keygen();
    repo(F, good.pub);
    const q = asks(F, ['ONE']);
    const slug = `secret-${q.split('-').slice(1, 3).join('-')}`;
    const fake = path.join(F.old, '.worktrees', `chore-${slug}`);
    write(path.join(fake, 'secrets/app.enc.env'), 'SEED=1\n');
    encrypt(evil.pub, path.join(fake, 'secrets/app.enc.env'));
    const before = fs.readFileSync(path.join(fake, 'secrets/app.enc.env'), 'utf8');
    write(path.join(F.old, 'secrets/sops-age-key.dec'), `${evil.id}\n`);
    const r = F.run(F.old, ['secret', 'post', q, '--json'], {}, JSON.stringify({ ONE: 'value-one-9' }));
    assert.notEqual(r.status, 0);
    assert.equal(fs.readFileSync(path.join(fake, 'secrets/app.enc.env'), 'utf8'), before, 'the planted file got nothing');
    for (const f of fs.readdirSync(path.join(F.old, '.worktrees'))) { const p2 = path.join(F.old, '.worktrees', f, 'secrets/app.enc.env'); if (fs.existsSync(p2)) assert.doesNotMatch(decrypt(evil.id, p2).stdout ?? '', /value-one-9/, "the planter's key never opens the value"); }
  } finally { F.done(); }
});

const stanza = (text) => text.match(/^sops_age__list_0__map_enc=.*$/m)?.[0];

test('a tampered worktree, a moved local main and a replace ref never choose the store', { skip: !real }, () => {
  const F = fleetFixture('sops-tamper');
  try {
    const good = keygen();
    repo(F, good.pub);
    const real0 = fs.readFileSync(path.join(F.old, 'secrets/app.enc.env'), 'utf8');
    const q = asks(F, ['ONE']);
    const slug = `secret-${q.split('-').slice(1, 3).join('-')}`;
    const wt = path.join(F.old, '.worktrees', `chore-${slug}`);
    F.g(['worktree', 'add', '-q', '-b', `chore-${slug}`, wt, 'origin/main'], F.old);
    // anyone can encrypt to the public key, with a data key they know
    write(path.join(wt, 'secrets/app.enc.env'), 'SEED=1\n');
    encrypt(good.pub, path.join(wt, 'secrets/app.enc.env'));
    const planted = fs.readFileSync(path.join(wt, 'secrets/app.enc.env'), 'utf8');
    assert.notEqual(stanza(planted), stanza(real0));
    F.g(['add', '-A', 'secrets'], wt);
    F.g(['commit', '-qm', 'planted'], wt);
    const evilBlob = F.g(['rev-parse', 'HEAD:secrets/app.enc.env'], wt).trim();
    const realBlob = F.g(['rev-parse', 'origin/main:secrets/app.enc.env'], F.old).trim();
    F.g(['replace', realBlob, evilBlob], F.old);
    write(path.join(F.old, 'secrets/sops-age-key.dec'), `${good.id}\n`);
    const r = F.run(F.old, ['secret', 'post', q, '--json'], {}, JSON.stringify({ ONE: 'value-one-9' }));
    assert.equal(r.status, 0, r.out + r.err);
    const after = fs.readFileSync(path.join(wt, 'secrets/app.enc.env'), 'utf8');
    assert.equal(stanza(after), stanza(real0), "the value is under the remote store's data key");
    assert.match(decrypt(good.id, path.join(wt, 'secrets/app.enc.env')).stdout, /ONE=value-one-9/);
  } finally { F.done(); }
});

test('a store takes all of a question\'s secrets in one post, and a failed one saves nothing', { skip: !real }, () => {
  const F = fleetFixture('sops-whole');
  try {
    const good = keygen();
    repo(F, good.pub);
    write(path.join(F.old, 'secrets/sops-age-key.dec'), `${good.id}\n`);
    const q = asks(F, ['ONE', 'TWO']);
    const part = F.run(F.old, ['secret', 'post', q, '--json'], {}, JSON.stringify({ ONE: 'value-one-9' }));
    assert.notEqual(part.status, 0);
    assert.match(part.out + part.err, /takes all of this question's secrets in one post: add TWO too/);
    assert.ok(!fs.existsSync(path.join(F.old, '.worktrees')) || !fs.readdirSync(path.join(F.old, '.worktrees')).some((x) => x.startsWith('chore-secret-')), 'refused before anything ran');
    const all = F.run(F.old, ['secret', 'post', q, '--json'], {}, JSON.stringify({ ONE: 'value-one-9', TWO: 'value-two-9' }));
    assert.equal(all.status, 0, all.out + all.err);
    const w = path.join(F.old, '.worktrees', fs.readdirSync(path.join(F.old, '.worktrees')).find((x) => x.startsWith('chore-secret-')));
    const plain = decrypt(good.id, path.join(w, 'secrets/app.enc.env')).stdout;
    assert.match(plain, /ONE=value-one-9/);
    assert.match(plain, /TWO=value-two-9/);
    const list = F.ok(F.old, ['ask', '--kind', 'owner-action', '--question', 'Post the list key', '--secrets', JSON.stringify([{ name: 'L', sink: 'sops:secrets/app.enc.env:list.0' }])], SUP);
    const bad = F.run(F.old, ['secret', 'post', list, '--json'], {}, JSON.stringify({ L: 'value-l-9' }));
    assert.notEqual(bad.status, 0);
    assert.match(bad.out + bad.err, /names map keys, not list positions/);
  } finally { F.done(); }
});

test('a branch whose name ends in refs/heads/main never supplies the store', { skip: !real }, () => {
  const F = fleetFixture('sops-ref');
  try {
    const good = keygen(); const evil = keygen();
    repo(F, good.pub);
    const real0 = fs.readFileSync(path.join(F.old, 'secrets/app.enc.env'), 'utf8');
    // a store for the owner's recipient and the pusher's own, on a branch that sorts before main
    const w = path.join(F.base, 'pusher');
    F.g(['worktree', 'add', '-q', '-b', 'pusher', w, 'origin/main'], F.old);
    write(path.join(w, 'secrets/app.enc.env'), 'SEED=1\n');
    encrypt(`${good.pub},${evil.pub}`, path.join(w, 'secrets/app.enc.env'));
    F.g(['add', '-A', 'secrets'], w);
    F.g(['commit', '-qm', 'planted'], w);
    F.g(['push', '-q', 'origin', 'pusher:refs/heads/a/refs/heads/main'], w);
    F.g(['fetch', '-q', 'origin', '+refs/heads/*:refs/remotes/origin/*'], F.old);
    write(path.join(F.old, 'secrets/sops-age-key.dec'), `${good.id}\n`);
    const q = asks(F, ['ONE']);
    const r = F.run(F.old, ['secret', 'post', q, '--json'], {}, JSON.stringify({ ONE: 'value-one-9' }));
    assert.equal(r.status, 0, r.out + r.err);
    const c = fs.readdirSync(path.join(F.old, '.worktrees')).find((x) => x.startsWith('chore-secret-'));
    const after = path.join(F.old, '.worktrees', c, 'secrets/app.enc.env');
    assert.equal(stanza(fs.readFileSync(after, 'utf8')), stanza(real0), "main's own store");
    assert.equal(decrypt(evil.id, after).status === 0, false, "the pusher's key can't open it");
  } finally { F.done(); }
});

test('the remote moved since the last fetch: the post reads its new main', { skip: !real }, () => {
  const F = fleetFixture('sops-moved');
  try {
    const good = keygen();
    repo(F, good.pub);
    const other = path.join(F.base, 'other');
    F.g(['clone', '-q', F.org, other]);
    for (const [k, v] of [['user.email', 't@t'], ['user.name', 't']]) F.g(['config', k, v], other);
    write(path.join(other, 'unrelated.txt'), 'x\n');
    F.g(['add', '-A'], other); F.g(['commit', '-qm', 'unrelated'], other); F.g(['push', '-q', 'origin', 'main'], other);
    write(path.join(F.old, 'secrets/sops-age-key.dec'), `${good.id}\n`);
    const q = asks(F, ['ONE']);
    const r = F.run(F.old, ['secret', 'post', q, '--json'], {}, JSON.stringify({ ONE: 'value-one-9' }));
    assert.equal(r.status, 0, r.out + r.err);
  } finally { F.done(); }
});

test('two posts at once for one question: one lands whole, the other says it posted nothing', { skip: !real }, async () => {
  const F = fleetFixture('sops-race');
  try {
    const good = keygen();
    repo(F, good.pub);
    write(path.join(F.old, 'secrets/sops-age-key.dec'), `${good.id}\n`);
    const q = asks(F, ['ONE', 'TWO']);
    const bin = path.join(F.base, 'slow-bin');
    const realSops = spawnSync('sh', ['-c', 'command -v sops'], { encoding: 'utf8' }).stdout.trim();
    write(path.join(bin, 'sops'), `#!/bin/sh\nsleep 1\nexec "${realSops}" "$@"\n`);
    fs.chmodSync(path.join(bin, 'sops'), 0o755);
    const env = F.env({ PATH: `${bin}${path.delimiter}${process.env.PATH}` });
    const post = (tag) => new Promise((done) => {
      let err = '';
      const c = spawn(process.execPath, [path.join(F.old, 'docs/devteam/scripts/devteam.mjs'), 'secret', 'post', q, '--json'], { cwd: F.old, env, stdio: ['pipe', 'ignore', 'pipe'] });
      c.stderr.on('data', (d) => { err += d; });
      c.stdin.end(JSON.stringify({ ONE: `one-${tag}-9`, TWO: `two-${tag}-9` }));
      c.on('close', (code) => done({ code, err, tag }));
    });
    const rs = await Promise.all([post('a'), post('b')]);
    const won = rs.filter((r) => r.code === 0);
    assert.equal(won.length, 1, rs.map((r) => r.err).join('\n'));
    assert.match(rs.find((r) => r.code !== 0).err, /is already answered|nothing was posted from this run/, 'the loser posted nothing and says so');
    const w = fs.readdirSync(path.join(F.old, '.worktrees')).find((x) => x.startsWith('chore-secret-'));
    const plain = decrypt(good.id, path.join(F.old, '.worktrees', w, 'secrets/app.enc.env')).stdout;
    assert.match(plain, new RegExp(`ONE=one-${won[0].tag}-9`));
    assert.match(plain, new RegExp(`TWO=two-${won[0].tag}-9`));
  } finally { F.done(); }
});

test('a dead holder\'s lock: posts racing to clear it never run together', { skip: !real }, async () => {
  const F = fleetFixture('sops-dead-lock');
  try {
    const good = keygen();
    repo(F, good.pub);
    write(path.join(F.old, 'secrets/sops-age-key.dec'), `${good.id}\n`);
    const q = asks(F, ['ONE', 'TWO']);
    // a post killed while holding the lock leaves it behind, naming a process that is gone
    write(path.join(F.old, 'docs/devteam/run/secret-locks', encodeURIComponent(q)), '2147483646:dead');
    const bin = path.join(F.base, 'slow-bin');
    const realSops = spawnSync('sh', ['-c', 'command -v sops'], { encoding: 'utf8' }).stdout.trim();
    // sops notes any call that starts while another post's call is still running
    const busy = path.join(F.base, 'sops-busy');
    const overlap = path.join(F.base, 'sops-overlap');
    write(path.join(bin, 'sops'), `#!/bin/sh\n[ -e "${busy}" ] && touch "${overlap}"\ntouch "${busy}"\nsleep 1\n"${realSops}" "$@"\ns=$?\nrm -f "${busy}"\nexit $s\n`);
    fs.chmodSync(path.join(bin, 'sops'), 0o755);
    const env = F.env({ PATH: `${bin}${path.delimiter}${process.env.PATH}` });
    const post = (tag) => new Promise((done) => {
      let err = '';
      const c = spawn(process.execPath, [path.join(F.old, 'docs/devteam/scripts/devteam.mjs'), 'secret', 'post', q, '--json'], { cwd: F.old, env, stdio: ['pipe', 'ignore', 'pipe'] });
      c.stderr.on('data', (d) => { err += d; });
      c.stdin.end(JSON.stringify({ ONE: `one-${tag}-9`, TWO: `two-${tag}-9` }));
      c.on('close', (code) => done({ code, err, tag }));
    });
    const rs = await Promise.all(['a', 'b', 'c', 'd'].map(post));
    assert.ok(!fs.existsSync(overlap), 'two posts held the lock at once');
    const won = rs.filter((r) => r.code === 0);
    assert.equal(won.length, 1, rs.map((r) => r.err).join('\n'));
    for (const r of rs.filter((x) => x.code !== 0)) assert.match(r.err, /is already answered|nothing was posted from this run/);
    const w = fs.readdirSync(path.join(F.old, '.worktrees')).find((x) => x.startsWith('chore-secret-'));
    const plain = decrypt(good.id, path.join(F.old, '.worktrees', w, 'secrets/app.enc.env')).stdout;
    assert.match(plain, new RegExp(`ONE=one-${won[0].tag}-9`));
    assert.match(plain, new RegExp(`TWO=two-${won[0].tag}-9`));
    assert.deepEqual(fs.readdirSync(path.join(F.old, 'docs/devteam/run/secret-locks')), [], 'no lock or claim file is left behind');
  } finally { F.done(); }
});

// A preload for a post under test: it changes only that process's view of time, link() or rm().
const preload = (F, name, body) => {
  const f = path.join(F.base, `${name}.mjs`);
  write(f, body);
  return `--import=${pathToFileURL(f).href}`;
};
const noChore = (F) => !fs.existsSync(path.join(F.old, '.worktrees')) || !fs.readdirSync(path.join(F.old, '.worktrees')).some((x) => x.startsWith('chore-secret-'));
const postBounded = (F, q, extra) => spawnSync(process.execPath, [path.join(F.old, 'docs/devteam/scripts/devteam.mjs'), 'secret', 'post', q, '--json'], { cwd: F.old, env: F.env(extra), input: JSON.stringify({ ONE: 'value-one-9', TWO: 'value-two-9' }), encoding: 'utf8', timeout: 20000, killSignal: 'SIGKILL' });
const lockFixture = (name) => {
  const F = fleetFixture(name);
  const good = keygen();
  repo(F, good.pub);
  write(path.join(F.old, 'secrets/sops-age-key.dec'), `${good.id}\n`);
  const q = asks(F, ['ONE', 'TWO']);
  const dir = path.join(F.old, 'docs/devteam/run/secret-locks');
  fs.mkdirSync(dir, { recursive: true });
  return { F, q, dir, lock: path.join(dir, encodeURIComponent(q)), good };
};
const plain = (r, lock, what) => {
  assert.equal(r.signal, null, 'the post spun or hung until it was killed');
  assert.notEqual(r.status, 0, 'the post went ahead');
  assert.ok(r.stderr.includes(`${lock} is ${what}, not a lock file. Nothing was posted; remove it${what === 'a folder' ? ' (rm -r)' : ''} and post again`), r.stderr);
  assert.doesNotMatch(r.stderr, /ERR_FS|^\s+at /m);
};

test('a dangling link at the lock path: the post waits, stops at the deadline and names it', { skip: !real }, () => {
  const { F, q, lock } = lockFixture('sops-lock-dangling');
  try {
    fs.symlinkSync(path.join(F.base, 'nothing-here'), lock);
    // the clock moves only when the post waits, so a post that never waits never reaches the deadline
    const clock = preload(F, 'clock', 'const now = Date.now; const w = Atomics.wait; let skew = 0;\nAtomics.wait = (...a) => { skew += 61000; return w.apply(Atomics, a); };\nDate.now = () => now() + skew;\n');
    plain(postBounded(F, q, { NODE_OPTIONS: clock }), lock, 'a link to nothing');
    assert.ok(noChore(F), 'nothing was posted');
  } finally { F.done(); }
});

for (const [what, label, plant] of [
  ['a folder', 'a folder', (F, lock) => fs.mkdirSync(lock)],
  ['a named pipe', 'a named pipe', (F, lock) => assert.equal(spawnSync('mkfifo', [lock]).status, 0)],
  ['a link', 'a link to a folder', (F, lock) => { fs.mkdirSync(path.join(F.base, 'a-folder')); fs.symlinkSync(path.join(F.base, 'a-folder'), lock); }],
  ['a link', 'a link to a dead holder\'s lock file', (F, lock) => { write(path.join(F.base, 'a-file'), '2147483646:dead'); fs.symlinkSync(path.join(F.base, 'a-file'), lock); }],
]) test(`${label} at the lock path is named in a plain refusal, and nothing is posted`, { skip: !real }, () => {
  const { F, q, lock } = lockFixture('sops-lock-odd');
  try {
    plant(F, lock);
    plain(postBounded(F, q, {}), lock, what);
    assert.ok(noChore(F), 'nothing was posted');
  } finally { F.done(); }
});

test('a folder put at the lock path while a dead lock is cleared is named, and .clearing is let go', { skip: !real }, () => {
  const { F, q, dir, lock } = lockFixture('sops-lock-swap');
  try {
    write(lock, ''); // an empty lock names no holder: it is a dead one's
    const swap = preload(F, 'swap', `import fs from 'node:fs';
const link = fs.linkSync; let first = true;
fs.linkSync = (a, b) => { if (first && String(b).endsWith('.clearing')) { first = false; fs.unlinkSync(${JSON.stringify(lock)}); fs.mkdirSync(${JSON.stringify(lock)}); } return link(a, b); };
`);
    plain(postBounded(F, q, { NODE_OPTIONS: swap }), lock, 'a folder');
    assert.ok(noChore(F), 'nothing was posted');
    assert.deepEqual(fs.readdirSync(dir), [path.basename(lock)], 'only the planted folder is left: no .clearing');
  } finally { F.done(); }
});

test('a filesystem that refuses hard links: both posts refuse plainly and neither holds the lock', { skip: !real }, async () => {
  const { F, q, dir } = lockFixture('sops-lock-nolink');
  try {
    const nolink = preload(F, 'nolink', "import fs from 'node:fs';\nconst link = fs.linkSync;\nfs.linkSync = (a, b) => { if (String(b).includes('secret-locks')) throw Object.assign(new Error('EPERM: operation not permitted, link'), { code: 'EPERM' }); return link(a, b); };\n");
    const post = () => new Promise((done) => {
      let err = '';
      const c = spawn(process.execPath, [path.join(F.old, 'docs/devteam/scripts/devteam.mjs'), 'secret', 'post', q, '--json'], { cwd: F.old, env: F.env({ NODE_OPTIONS: nolink }), stdio: ['pipe', 'ignore', 'pipe'] });
      c.stderr.on('data', (d) => { err += d; });
      c.stdin.end(JSON.stringify({ ONE: 'value-one-9', TWO: 'value-two-9' }));
      c.on('close', (code) => done({ code, err }));
    });
    for (const r of await Promise.all([post(), post()])) {
      assert.notEqual(r.code, 0);
      assert.match(r.err, /refused a hard link \(EPERM\)\. Nothing was posted/);
      assert.doesNotMatch(r.err, /^\s+at /m);
    }
    assert.ok(noChore(F), 'nothing was posted');
    assert.deepEqual(fs.readdirSync(dir), [], 'no lock or private file is left behind');
  } finally { F.done(); }
});

test('a dead holder\'s lock: a post that saw it dead never clears the live lock taken meanwhile', { skip: !real }, async () => {
  const { F, q, dir, lock, good } = lockFixture('sops-dead-lock-forced');
  try {
    // a post killed while holding the lock leaves it behind, naming a process that is gone
    write(lock, '2147483646:dead');
    const bin = path.join(F.base, 'slow-bin');
    const realSops = spawnSync('sh', ['-c', 'command -v sops'], { encoding: 'utf8' }).stdout.trim();
    const f = (n) => path.join(F.base, n);
    const [busy, overlap, holding, sawDead, cleared, stuck, trace] = ['sops-busy', 'sops-overlap', 'holder-in-sops', 'late-saw-dead', 'late-cleared', 'gate-stuck', 'trace'].map(f);
    const told = () => (fs.existsSync(trace) ? fs.readFileSync(trace, 'utf8') : '(no trace)');
    // A call notes another post's call still running. The holder, inside sops, waits for the late post to
    // finish its clearing and checks its lock is still there and still its own.
    write(path.join(bin, 'sops'), `#!/bin/sh
mine=$(cat "${lock}" 2>/dev/null)
[ -e "${busy}" ] && touch "${overlap}"
touch "${busy}" "${holding}"
echo "sops $$ start busy=$([ -e "${busy}" ] && echo y) lock=$mine" >> "${trace}"
n=0; while [ ! -e "${cleared}" ]; do n=$((n+1)); [ $n -gt 600 ] && { touch "${stuck}"; break; }; sleep 0.1; done
now=$(cat "${lock}" 2>/dev/null)
echo "sops $$ checked lock=$now" >> "${trace}"
[ -n "$mine" ] && [ "$now" = "$mine" ] || touch "${overlap}"
"${realSops}" "$@"
s=$?
rm -f "${busy}"
exit $s
`);
    fs.chmodSync(path.join(bin, 'sops'), 0o755);
    // forced order: late sees the dead lock and stops; early clears it, takes it and enters sops; late then
    // clears (or, with the lock right, declines to), and lets .clearing go
    const gate = preload(F, 'gate', `import fs from 'node:fs';
const role = process.env.LOCK_ROLE; let first = true;
const note = (m) => fs.appendFileSync(${JSON.stringify(trace)}, role + ' ' + process.pid + ' ' + m + '\\n');
const tail = (p) => String(p).split('/').pop().slice(-12);
const until = (f) => { const t = Date.now(); while (!fs.existsSync(f)) { if (Date.now() - t > 60000) throw new Error('gate timed out: ' + f); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10); } };
const link = fs.linkSync; const rm = fs.rmSync;
fs.linkSync = (a, b) => {
  if (first && String(b).endsWith('.clearing')) {
    first = false;
    if (role === 'late') { fs.writeFileSync(${JSON.stringify(sawDead)}, ''); until(${JSON.stringify(holding)}); } else until(${JSON.stringify(sawDead)});
  }
  try { link(a, b); note('took ' + tail(b)); } catch (e) { note('link ' + tail(b) + ' ' + e.code); throw e; }
};
const unlink = fs.unlinkSync;
fs.unlinkSync = (p) => { note('unlinked ' + tail(p)); return unlink(p); };
fs.rmSync = (p, o) => { const r = rm(p, o); if (!String(p).includes('.' + process.pid + '.')) note('rm ' + tail(p)); if (role === 'late' && String(p).endsWith('.clearing')) fs.writeFileSync(${JSON.stringify(cleared)}, ''); return r; };
`);
    const post = (role) => new Promise((done) => {
      let err = '';
      const c = spawn(process.execPath, [path.join(F.old, 'docs/devteam/scripts/devteam.mjs'), 'secret', 'post', q, '--json'], { cwd: F.old, env: F.env({ PATH: `${bin}${path.delimiter}${process.env.PATH}`, NODE_OPTIONS: gate, LOCK_ROLE: role }), stdio: ['pipe', 'ignore', 'pipe'] });
      c.stderr.on('data', (d) => { err += d; });
      c.stdin.end(JSON.stringify({ ONE: `one-${role}-9`, TWO: `two-${role}-9` }));
      c.on('close', (code) => done({ code, err, role }));
    });
    const rs = await Promise.all([post('early'), post('late')]);
    assert.ok(fs.existsSync(sawDead) && fs.existsSync(holding) && fs.existsSync(cleared) && !fs.existsSync(stuck), `the forced order ran\n${told()}`);
    assert.ok(!fs.existsSync(overlap), `two posts held the lock at once\n${told()}`);
    const won = rs.filter((r) => r.code === 0);
    assert.equal(won.length, 1, `${rs.map((r) => r.err).join('\n')}\n${told()}`);
    assert.equal(won[0].role, 'early', told());
    for (const r of rs.filter((x) => x.code !== 0)) assert.match(r.err, /is already answered|nothing was posted from this run/);
    const w = fs.readdirSync(path.join(F.old, '.worktrees')).find((x) => x.startsWith('chore-secret-'));
    const text = decrypt(good.id, path.join(F.old, '.worktrees', w, 'secrets/app.enc.env')).stdout;
    assert.match(text, /ONE=one-early-9/);
    assert.match(text, /TWO=two-early-9/);
    assert.deepEqual(fs.readdirSync(dir), [], 'no lock or claim file is left behind');
  } finally { F.done(); }
});

test('a post that died while clearing a dead lock: the next post refuses and names what to remove', { skip: !real }, () => {
  const F = fleetFixture('sops-dead-clearing');
  try {
    const good = keygen();
    repo(F, good.pub);
    write(path.join(F.old, 'secrets/sops-age-key.dec'), `${good.id}\n`);
    const q = asks(F, ['ONE', 'TWO']);
    const lock = path.join(F.old, 'docs/devteam/run/secret-locks', encodeURIComponent(q));
    write(lock, '2147483646:dead');
    write(`${lock}.clearing`, '2147483645:dead');
    const r = F.run(F.old, ['secret', 'post', q, '--json'], {}, JSON.stringify({ ONE: 'value-one-9', TWO: 'value-two-9' }));
    assert.notEqual(r.status, 0);
    assert.match(r.out + r.err, /died while clearing a stale lock; remove .*\.clearing and post again/);
    assert.ok(!fs.existsSync(path.join(F.old, '.worktrees')) || !fs.readdirSync(path.join(F.old, '.worktrees')).some((x) => x.startsWith('chore-secret-')), 'nothing ran');
  } finally { F.done(); }
});

test('a store an older kit part-posted is refused plainly, and nothing is posted', { skip: !real }, () => {
  const F = fleetFixture('sops-older-part');
  try {
    const good = keygen();
    repo(F, good.pub);
    write(path.join(F.old, 'secrets/sops-age-key.dec'), `${good.id}\n`);
    const q = asks(F, ['ONE', 'TWO']);
    // an older kit posted a store's secrets one at a time, and recorded ONE alone
    fs.appendFileSync(path.join(F.old, 'docs/devteam/run/log', `owner-${new Date().toISOString().slice(0, 7)}.jsonl`), `${JSON.stringify({ v: 1, id: q, type: 'question', op: 'set', at: new Date().toISOString(), by: 'owner', secrets_posted: [{ name: 'ONE', at: new Date().toISOString() }] })}\n`);
    const r = F.run(F.old, ['secret', 'post', q, '--json'], {}, JSON.stringify({ TWO: 'value-two-9' }));
    assert.notEqual(r.status, 0);
    assert.doesNotMatch(r.out + r.err, /ReferenceError/);
    assert.match(r.out + r.err, /ONE already went to secrets\/app\.enc\.env/);
    const w = fs.existsSync(path.join(F.old, '.worktrees')) ? fs.readdirSync(path.join(F.old, '.worktrees')).find((x) => x.startsWith('chore-secret-')) : null;
    if (w) assert.doesNotMatch(decrypt(good.id, path.join(F.old, '.worktrees', w, 'secrets/app.enc.env')).stdout, /value-two-9/);
  } finally { F.done(); }
});

test('a stdin sink that stops reading: exit 0 is not posted, and a refusal shows its own error', () => {
  const F = fleetFixture('sink-epipe');
  try {
    const bin = path.join(F.base, 'sink-bin');
    write(path.join(bin, 'quit-ok'), '#!/bin/sh\nexit 0\n');
    write(path.join(bin, 'quit-no'), '#!/bin/sh\necho "my own refusal" >&2\nexit 3\n');
    for (const n of ['quit-ok', 'quit-no']) fs.chmodSync(path.join(bin, n), 0o755);
    const PATHED = { PATH: `${bin}${path.delimiter}${process.env.PATH}` };
    const sp = path.join(F.old, 'docs/devteam/project/settings.md');
    const text = fs.readFileSync(sp, 'utf8');
    const m = text.match(/```json devteam\s*\n([\s\S]*?)\n```/);
    fs.writeFileSync(sp, text.replace(m[1], JSON.stringify({ ...JSON.parse(m[1]), secret_commands: ['quit-ok', 'quit-no'] }, null, 2)));
    F.g(['add', '-A', 'docs/devteam/project/settings.md'], F.old);
    F.g(['commit', '-qm', 'allow'], F.old);
    F.g(['push', '-q', 'origin', 'main'], F.old);
    const big = 'x'.repeat(300000);
    const post = (cmd) => F.run(F.old, ['secret', 'post', F.ok(F.old, ['ask', '--kind', 'owner-action', '--question', 'Post it', '--secrets', JSON.stringify([{ name: 'K', sink: `stdin:${cmd}` }])], SUP), '--json'], PATHED, JSON.stringify({ K: big }));
    assert.notEqual(post('quit-ok').status, 0, 'a sink that took none of the value did not post it');
    const no = post('quit-no');
    assert.notEqual(no.status, 0);
    assert.match(no.out + no.err, /my own refusal/);
  } finally { F.done(); }
});
