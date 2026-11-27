// packageProvenance (kit-974; kit-install@1's Provenance): the signed statement of the very tarball pinned
// must name the kit's repo, release.yml, the tag and its commit on upstream's main. Checks are numbered
// as in the ticket's spec (P1 to P16). The function has no command of its own (kit-956's install and
// kit-957's merge call it), so each fixture instance's kit copy gains a probe subcommand,
// `package __provenance '<json>'`, that prints its result: the real function, in a real instance, run
// by the real CLI. The registry is test/lib/fake-registry.mjs (its bundles signed by its own test CA),
// or, for dev-951's recorded bundle (test/fixtures/npm-attestation/), a loopback server of this file's.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { bareProject } from './lib/kit.mjs';
import { startFakeRegistry, FIXTURES, NAME } from './lib/fake-registry.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-package-provenance-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
let n = 0;
const scratch = (name) => { const d = path.join(tmp, `${++n}-${name}`); fs.mkdirSync(d, { recursive: true }); return d; };
const g = (args, cwd) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

const REC = path.resolve(path.dirname(new URL(import.meta.url).pathname), 'fixtures', 'npm-attestation', 'bundle.json');
// dev-951's recorded bundle: @sigstore/protobuf-specs@0.5.2, its manifest's integrity, and the five
// facts its findings table gives (docs/devteam/project/tickets/dev-951-npm-first-publish-spike/findings.md)
const RECORDED = {
  name: '@sigstore/protobuf-specs',
  version: '0.5.2',
  integrity: 'sha512-SQqvFMt4V78fdjcDdYX6HbiVSOR4QK3ZgwCa2KOsopAgPIHy1rU5UDUmzLl02r5oyyaYcYHR1hpwDRk/yUe+Mw==',
  read: {
    digest: '490aaf14cb7857bf1f7637037585fa1db89548e47840add983009ad8a3aca290203c81f2d6b539503526ccb974dabe68cb26987181d1d61a700d193fc947be33',
    repo: 'sigstore/protobuf-specs',
    workflow: '.github/workflows/typescript-publish.yml',
    ref: 'refs/tags/release/typescript/v0.5.2',
    commit: '0342fe5797edd558c58098033220fb27a2542a28',
  },
};
const integrityOf = (version) => `sha512-${crypto.createHash('sha512').update(fs.readFileSync(path.join(FIXTURES, 'registry', `devteam-${version}.tgz`))).digest('base64')}`;

// upstream: a repo whose main holds v0.101.0's commit and whose side branch holds v0.100.0's; v1.0.0 is
// not tagged. The registry's statements name these commits (its { commits } option).
function upstream() {
  const u = path.join(scratch('upstream'), 'devteam');
  fs.mkdirSync(u);
  g(['init', '-q', '-b', 'main'], u);
  g(['commit', '-q', '--allow-empty', '-m', 'one'], u);
  g(['tag', '-a', 'v0.101.0', '-m', 'v0.101.0'], u);
  g(['checkout', '-q', '-b', 'side'], u);
  g(['commit', '-q', '--allow-empty', '-m', 'side'], u);
  g(['tag', 'v0.100.0'], u);
  g(['checkout', '-q', 'main'], u);
  g(['commit', '-q', '--allow-empty', '-m', 'two'], u);
  const sha = (r) => g(['rev-parse', `${r}^{commit}`], u);
  return { dir: u, commits: { '0.101.0': sha('v0.101.0'), '0.100.0': sha('v0.100.0') } };
}
// A fixture instance: the kit copied in with the probe subcommand, init run, main pushed to an origin.
function instance(name) {
  const base = scratch(name);
  const origin = path.join(base, 'origin.git');
  const root = bareProject(base, 'pkg');
  const f = path.join(root, 'docs', 'devteam', 'scripts', 'devteam.mjs');
  const src = fs.readFileSync(f, 'utf8');
  const at = 'function cmdPackage() {\n';
  assert.equal(src.split(at).length, 2, 'the kit declares cmdPackage once');
  assert.equal(src.split('\nfunction packageProvenance(').length, 2, 'the kit declares packageProvenance once');
  fs.writeFileSync(f, src.replace(at, () => `${at}  if (positional[0] === '__provenance') { let r; try { r = packageProvenance(JSON.parse(positional[1])); } catch (e) { r = { thrown: e.code ?? null, message: e.message }; } return out(JSON.stringify(r)); }\n`));
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  g(['remote', 'add', 'origin', origin], root);
  g(['add', '-A'], root);
  g(['commit', '-qm', 'init'], root);
  g(['push', '-q', 'origin', 'main'], root);
  // no DEVTEAM_* of the machine's, a hub port of its own, a HOME of its own
  const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('DEVTEAM_') && !/^GIT_/.test(k)));
  clean.HOME = path.join(base, 'home');
  fs.mkdirSync(clean.HOME);
  clean.DEVTEAM_HUB_PORT = '4999';
  // settings.md's upstream_repo, committed (and pushed to main unless { push: false })
  const upstreamRepo = (value, { push = true } = {}) => {
    const sf = path.join(root, 'docs/devteam/project/settings.md');
    const txt = fs.readFileSync(sf, 'utf8');
    const m = txt.match(/```json devteam\s*\n([\s\S]*?)\n```/);
    const j = JSON.parse(m[1]);
    j.upstream_repo = value;
    fs.writeFileSync(sf, txt.replace(m[1], () => JSON.stringify(j, null, 2)));
    g(['commit', '-qam', `upstream_repo ${value}`], root);
    if (push) g(['push', '-q', 'origin', 'HEAD:main'], root);
  };
  const prov = (args, env) => {
    const r = spawnSync(process.execPath, [f, 'package', '__provenance', JSON.stringify(args)], { cwd: root, env, encoding: 'utf8', timeout: 300000 });
    assert.equal(r.status, 0, `the probe ran: ${r.stderr}`);
    return JSON.parse(r.stdout);
  };
  return { root, clean, prov, upstreamRepo };
}
// git, in the registry's HOME, fetches https://github.com/<repo>.git from a local folder
function gitconfig(home, map) {
  fs.writeFileSync(path.join(home, '.gitconfig'), Object.entries(map).map(([url, dir]) => `[url "${dir}"]\n\tinsteadOf = ${url}\n`).join(''));
}
// a loopback registry of this file's that serves one bundle at the attestations path and logs each ask;
// in a process of its own, since the test blocks on spawnSync while the kit asks it
async function bundleServer(body) {
  const d = scratch('bundle-server');
  fs.writeFileSync(path.join(d, 'body'), body);
  const code = `const http = require('node:http'); const fs = require('node:fs'); const [body, log, want] = process.argv.slice(1);
const server = http.createServer((req, res) => { fs.appendFileSync(log, req.url + '\\n');
  if (req.url === want) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(fs.readFileSync(body)); }
  res.writeHead(404); res.end('{"error":"Not found"}'); });
server.listen(0, '127.0.0.1', () => process.stdout.write(server.address().port + '\\n'));
process.stdin.on('end', () => process.exit(0)); process.stdin.resume();`;
  const log = path.join(d, 'asked');
  fs.writeFileSync(log, '');
  const child = spawn(process.execPath, ['-e', code, path.join(d, 'body'), log, `/-/npm/v1/attestations/${RECORDED.name.replace('/', '%2f')}@${RECORDED.version}`], { stdio: ['pipe', 'pipe', 'inherit'] });
  const port = await new Promise((resolve, reject) => { child.stdout.once('data', (b) => resolve(String(b).trim())); child.once('exit', (c) => reject(new Error(`bundle server exited ${c}`))); });
  return {
    url: `http://127.0.0.1:${port}/`,
    asked: () => fs.readFileSync(log, 'utf8').split('\n').filter(Boolean),
    close: () => new Promise((resolve) => { child.once('exit', resolve); child.stdin.end(); }),
  };
}
// one fixture, one upstream and one fake registry, shared by the registry checks
async function setup(name, opts = {}) {
  const U = upstream();
  const I = instance(name);
  const reg = await startFakeRegistry({ commits: U.commits, ...opts });
  gitconfig(reg.home, { 'https://github.com/sanctuarycomputer/devteam.git': U.dir });
  const env = reg.env(I.clean);
  return { U, I, reg, env, good: (version = '0.101.0', extra = {}) => I.prov({ name: NAME, version, integrity: integrityOf(version), ...extra }, env) };
}

test('P1 the recorded bundle: packageProvenance reads the five facts from its signed statement', async () => {
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(REC)).digest('hex'), 'bd1bf0dfe108dcd57f21c28217aceaa63e041f9cc2023d1ba1deb283ca1c63d4', "P1 the fixture is dev-951's bundle.json, byte for byte");
  const I = instance('p1');
  I.upstreamRepo('sigstore/protobuf-specs');
  const s = await bundleServer(fs.readFileSync(REC));
  try {
    const r = I.prov(RECORDED, { ...I.clean, DEVTEAM_NPM_REGISTRY: s.url });
    assert.deepEqual(r.read, RECORDED.read, "P1 read: the subject digest, repository, workflow path, ref and commit, as dev-951's table gives them");
    // Sigstore's chain, the signature, the log's entry, the digest and the repository all pass; release.yml is ours, not sigstore's
    assert.equal(r.refused, 'workflow', `P1 every guard before the workflow passes on the real bundle (${r.why})`);
    // registry paths only: a process on the machine may knock on any loopback port (GET /)
    assert.equal(s.asked().filter((u) => u !== '/').length, 1, `P1 fetched once (${s.asked().join(' ')})`);
  } finally { await s.close(); }
});

test('P2 a forged copy of the recorded bundle (a changed predicate) is refused: the signature', async () => {
  const I = instance('p2');
  I.upstreamRepo('sigstore/protobuf-specs');
  const b = JSON.parse(fs.readFileSync(REC, 'utf8'));
  const a = b.attestations.find((x) => x.predicateType === 'https://slsa.dev/provenance/v1');
  const st = JSON.parse(Buffer.from(a.bundle.dsseEnvelope.payload, 'base64'));
  st.predicate.buildDefinition.externalParameters.workflow.path = '.github/workflows/release.yml';
  a.bundle.dsseEnvelope.payload = Buffer.from(JSON.stringify(st)).toString('base64');
  const s = await bundleServer(JSON.stringify(b));
  try {
    const r = I.prov(RECORDED, { ...I.clean, DEVTEAM_NPM_REGISTRY: s.url });
    assert.equal(r.read?.workflow, '.github/workflows/release.yml', 'P2 the forged statement names release.yml');
    assert.equal(r.refused, 'signature', `P2 refused for its signature (${JSON.stringify(r)})`);
    assert.match(r.why, /signature does not verify/, 'P2 and says so');
  } finally { await s.close(); }
});

test('P3 to P13: against the fake registry, a release.yml release passes and each difference is refused, named', async () => {
  const { U, reg, env, good, I } = await setup('p3');
  try {
    // P3 the pass: every guard
    const ok = good();
    assert.equal(ok.ok, true, `P3 0.101.0 passes (${JSON.stringify(ok)})`);
    assert.deepEqual(ok.provenance, { repo: 'sanctuarycomputer/devteam', workflow: '.github/workflows/release.yml', ref: 'refs/tags/v0.101.0', commit: U.commits['0.101.0'] }, 'P3 the provenance verified.json records');
    const refused = async (label, guard, run, why) => {
      const r = await run();
      assert.equal(r.ok, false, `${label}: not ok`);
      assert.equal(r.unreachable, false, `${label}: a refusal, not unreachable`);
      assert.equal(r.refused, guard, `${label}: refused by ${guard} (${JSON.stringify(r)})`);
      if (why) assert.match(r.why, why, `${label}: the reason named`);
    };
    // P4 no attestation; P5 no SLSA provenance among them
    await reg.fail('no-attestation');
    await refused('P4 no attestation', 'no-attestation', () => good(), /no attestations .*\(404\)/);
    await reg.fail(null);
    await reg.forge('no-slsa');
    await refused('P5 no SLSA provenance', 'slsa', () => good(), /0 SLSA provenance entries/);
    await reg.forge(null);
    // P6 a subject digest that differs from the lockfile's integrity
    await reg.fail('digest');
    await refused('P6 the statement names another digest', 'digest', () => good(), /not exactly one digest equal to the integrity/);
    await reg.fail(null);
    await refused('P6 the lockfile names another integrity', 'digest', () => good('0.101.0', { integrity: integrityOf('1.0.0') }));
    // P7 a repository other than upstream_repo
    await reg.fail('repo');
    await refused('P7 another repository', 'repo', () => good(), /someone-else\/devteam.*not https:\/\/github\.com\/sanctuarycomputer\/devteam/);
    await reg.fail(null);
    // P9 another workflow; P10 another ref
    await reg.fail('workflow');
    await refused('P9 another workflow', 'workflow', () => good(), /other\.yml.*not \.github\/workflows\/release\.yml/);
    await reg.fail('ref');
    await refused('P10 another ref', 'ref', () => good(), /refs\/heads\/main.*not refs\/tags\/v0\.101\.0/);
    // P11 a commit other than the tag's on upstream, and a tag upstream doesn't have
    await reg.fail('commit');
    await refused("P11 not the tag's commit", 'commit', () => good(), /is not the tag v0\.101\.0's at upstream/);
    await reg.fail(null);
    await refused('P11 no such tag upstream', 'tag', () => good('1.0.0'), /has no tag v1\.0\.0/);
    // P12 the tag's commit is not on upstream's default branch
    await refused('P12 off the default branch', 'default-branch', () => good('0.100.0'), /not on upstream's default branch/);
    // P13 what a forger can serve: changed after signing, another CA or one with the trusted names and another
    // key, a leaf that is a CA, a log time outside the leaf's, the log's entry or one naming something else, another identity
    // (another workflow, another repository, another ref, a ref the tag's is a prefix of)
    const forgeries = { forged: ['signature', /does not verify/], 'other-ca': ['certificate', /not issued by the test trust root/], expired: ['certificate-time', /not valid at the log's time/], 'bad-set': ['tlog', /signed entry timestamp does not verify/], 'no-tlog': ['tlog', /0 entries/], san: ['identity', /other\.yml.*not https:\/\/github\.com\/sanctuarycomputer\/devteam\/\.github\/workflows\/release\.yml@refs\/tags\/v0\.101\.0/], 'impostor-ca': ['certificate', /not issued by the test trust root/], 'leaf-ca': ['certificate', /not issued by the test trust root/], early: ['certificate-time', /not valid at the log's time/], 'entry-payload': ['tlog', /not for this statement, signature and certificate/], 'entry-sig': ['tlog', /not for this statement, signature and certificate/], 'entry-cert': ['tlog', /not for this statement, signature and certificate/], 'san-repo': ['identity', /devteam-fork\/\.github\/workflows\/release\.yml@refs\/tags\/v0\.101\.0"?, not https:\/\/github\.com\/sanctuarycomputer\/devteam\//], 'san-ref': ['identity', /release\.yml@refs\/pull\/1\/merge"?, not /], 'san-ref-prefix': ['identity', /@refs\/tags\/v0\.101\.0-x"?, not /] };
    for (const [forge, [guard, why]] of Object.entries(forgeries)) {
      await reg.forge(forge);
      await refused(`P13 ${forge}`, guard, () => good(), why);
    }
    await reg.forge(null);
    assert.equal(good().ok, true, 'P13 and the honest bundle passes again');
    // P8 upstream_repo is main's committed one: a PR's own change is ignored
    I.upstreamRepo('someone-else/devteam', { push: false });
    gitconfig(reg.home, { 'https://github.com/sanctuarycomputer/devteam.git': U.dir, 'https://github.com/someone-else/devteam.git': U.dir });
    assert.equal(good().ok, true, "P8 a branch's own upstream_repo changes nothing: main's is read");
    await refused("P8 the PR's repository is still refused", 'repo', () => good('0.99.0', { integrity: integrityOf('0.99.0') }), /not https:\/\/github\.com\/sanctuarycomputer\/devteam/);
    g(['push', '-q', 'origin', 'HEAD:main'], I.root);
    await refused("P8 once main's says someone-else, sanctuarycomputer's is refused", 'repo', () => good(), /not https:\/\/github\.com\/someone-else\/devteam/);
  } finally { await reg.close(); }
});

test('P14 the bundle is fetched once, from the registry the kit names, never through a redirect or npm config', async () => {
  const { reg, env, good, I } = await setup('p14', { fail: 'hostile-env' });
  try {
    const before = reg.requests().length;
    const r = good();
    assert.equal(r.ok, true, `P14 npm_config_registry and its kin in the environment change nothing (${JSON.stringify(r)})`);
    // registry paths only: a process on the machine may knock on any loopback port (GET /)
    const asked = reg.requests().slice(before).map((q) => q.url).filter((u) => u !== '/');
    assert.deepEqual(asked, [`/-/npm/v1/attestations/${NAME.replace('/', '%2f')}@0.101.0`], 'P14 one request: the bundle, once');
    assert.deepEqual(reg.calls(), [], 'P14 and no npm call');
    await reg.fail('redirect');
    const b2 = reg.requests().length;
    const red = good();
    assert.equal(red.unreachable, true, `P14 a redirect is unreachable (${JSON.stringify(red)})`);
    assert.equal(red.ok, false, 'P14 never a pass');
    assert.ok(!reg.requests().slice(b2).some((q) => q.url.startsWith('/-/moved/')), 'P14 the redirect is not followed');
    for (const bad of ['http://localhost:1/', 'https://registry.npmjs.org/', 'http://127.0.0.1:0/']) {
      const t = I.prov({ name: NAME, version: '0.101.0', integrity: integrityOf('0.101.0') }, { ...env, DEVTEAM_NPM_REGISTRY: bad });
      assert.equal(t.thrown, 'EDEVTEAMREGISTRY', `P14 DEVTEAM_NPM_REGISTRY=${bad} throws as npmRun's rule says`);
    }
  } finally { await reg.close(); }
});

test('P15 an unreachable registry or upstream is reported unreachable, never a pass', async () => {
  const { reg, env, good, I } = await setup('p15');
  try {
    for (const f of ['unreachable', 'server-error']) {
      await reg.fail(f);
      const r = good();
      assert.equal(r.unreachable, true, `P15 ${f}: unreachable (${JSON.stringify(r)})`);
      assert.equal(r.ok, false, `P15 ${f}: never a pass`);
      assert.match(r.why, /can't be reached|answered 503/, `P15 ${f}: says so`);
    }
    await reg.fail(null);
    gitconfig(reg.home, { 'https://github.com/sanctuarycomputer/devteam.git': 'http://127.0.0.1:9/devteam.git' });
    const u = good();
    assert.equal(u.unreachable, true, `P15 upstream unreachable: unreachable (${JSON.stringify(u)})`);
    assert.equal(u.ok, false, 'P15 upstream unreachable: never a pass');
    assert.match(u.why, /upstream .* can't be reached/, 'P15 upstream: says so');
  } finally { await reg.close(); }
});

test('P16 the test CA: only beside a loopback registry, else every call is refused; it replaces the public root', async () => {
  const { reg, env, I } = await setup('p16');
  try {
    const args = { name: NAME, version: '0.101.0', integrity: integrityOf('0.101.0') };
    for (const unset of [{ DEVTEAM_NPM_REGISTRY: '' }, { DEVTEAM_NPM_REGISTRY: undefined }]) {
      const e = { ...env, ...unset };
      if (unset.DEVTEAM_NPM_REGISTRY === undefined) delete e.DEVTEAM_NPM_REGISTRY;
      const r = I.prov(args, e);
      assert.equal(r.refused, 'test-ca', `P16 DEVTEAM_SIGSTORE_TEST_CA with the public registry (${JSON.stringify(unset)}): refused whole (${JSON.stringify(r)})`);
    }
    const bad = path.join(reg.dir, 'not-a-root.json');
    fs.writeFileSync(bad, '{"v":1}');
    assert.equal(I.prov(args, { ...env, DEVTEAM_SIGSTORE_TEST_CA: bad }).refused, 'test-ca', 'P16 an unreadable trust root: refused whole');
  } finally { await reg.close(); }
  // the recorded bundle, signed by Sigstore, under the fake's test CA: its certificate is not trusted
  const P = instance('p16b');
  P.upstreamRepo('sigstore/protobuf-specs');
  const reg2 = await startFakeRegistry();
  const s = await bundleServer(fs.readFileSync(REC));
  try {
    const r = P.prov(RECORDED, { ...P.clean, DEVTEAM_NPM_REGISTRY: s.url, DEVTEAM_SIGSTORE_TEST_CA: reg2.caFile });
    assert.equal(r.refused, 'certificate', `P16 the test CA replaces Sigstore's root (${JSON.stringify(r)})`);
  } finally { await s.close(); await reg2.close(); }
});

test('P17 the temp folder: no repository around it is read, and none is left behind', async () => {
  const { reg, env, I } = await setup('p17');
  try {
    // a temp folder inside a repository whose own config forbids the local upstream: read, it would fail the call
    const around = scratch('p17-around');
    execFileSync('git', ['init', '-q', around]);
    execFileSync('git', ['config', 'protocol.file.allow', 'never'], { cwd: around });
    const tmp = path.join(around, 'tmp');
    fs.mkdirSync(tmp);
    const r = I.prov({ name: NAME, version: '0.101.0', integrity: integrityOf('0.101.0') }, { ...env, TMPDIR: tmp });
    assert.equal(r.ok, true, `P17 a repository around the temp folder changes nothing (${JSON.stringify(r)})`);
    assert.deepEqual(fs.readdirSync(tmp).filter((n) => n.startsWith('devteam-provenance-')), [], 'P17 no devteam-provenance-* folder is left');
  } finally { await reg.close(); }
});
