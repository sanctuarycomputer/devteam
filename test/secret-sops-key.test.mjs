// A secret posted to a SOPS file finds the repo's age key wherever the repo keeps it, and a planted
// key or file never gets the owner's value. Real sops and age; skipped where they are not installed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
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

test('two secrets posted in two runs both land', { skip: !real }, () => {
  const F = fleetFixture('sops-two');
  try {
    const good = keygen();
    repo(F, good.pub);
    write(path.join(F.old, 'secrets/sops-age-key.dec'), `${good.id}\n`);
    const q = asks(F, ['ONE', 'TWO']);
    assert.equal(F.run(F.old, ['secret', 'post', q, '--json'], {}, JSON.stringify({ ONE: 'value-one-9' })).status, 0);
    const second = F.run(F.old, ['secret', 'post', q, '--json'], {}, JSON.stringify({ TWO: 'value-two-9' }));
    assert.equal(second.status, 0, second.out + second.err);
    const w = fs.readdirSync(path.join(F.old, '.worktrees')).find((x) => x.startsWith('chore-secret-'));
    const plain = decrypt(good.id, path.join(F.old, '.worktrees', w, 'secrets/app.enc.env')).stdout;
    assert.match(plain, /ONE=value-one-9/);
    assert.match(plain, /TWO=value-two-9/);
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
