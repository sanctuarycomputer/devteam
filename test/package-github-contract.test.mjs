// kit-install@2 (kit-1050): the GitHub source's contract. githubAsset (the release asset fetcher),
// packManifest (the pack's own package.json), the fake GitHub in test/lib/fake-registry.mjs and its
// signed bundles, and the shape of a real actions/attest-build-provenance bundle
// (test/fixtures/github-attestation/). The contract is the comment above packagePinPair in
// docs/devteam/scripts/devteam.mjs. Checks are numbered as in the ticket's spec.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { kit, testDir, bareProject } from './lib/kit.mjs';
import { startFakeRegistry, GITHUB_FAILURES, FIXTURES, NAME, LOG_NAME, packName, releaseUrl } from './lib/fake-registry.mjs';

const SRC = fs.readFileSync(path.join(kit, 'scripts', 'devteam.mjs'), 'utf8');
const REPO = 'sanctuarycomputer/devteam';
const VERSIONS = ['0.99.0', '0.100.0', '0.101.0', '1.0.0'];
const tgzOf = (v) => fs.readFileSync(path.join(FIXTURES, 'registry', `devteam-${v}.tgz`));
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
// The test's own download from the fake, as a client of GitHub would: https URLs carried to the fake's
// origin by kit-install@2's mapping, redirects followed. Not githubAsset: it checks what the fake serves.
async function download(reg, url, { max = 10 } = {}) {
  const local = (u) => { const x = new URL(u); return x.hostname === 'github.com' ? `${reg.url}${x.pathname.slice(1)}${x.search}` : `${reg.url}-/githubusercontent/${x.hostname}${x.pathname}${x.search}`; };
  const hops = [];
  for (let u = url; ;) {
    const r = await fetch(local(u), { redirect: 'manual', signal: AbortSignal.timeout(20000) });
    if (r.status >= 300 && r.status < 400) { hops.push(r.headers.get('location')); if (hops.length > max) throw new Error('too many hops'); u = new URL(r.headers.get('location'), u).href; continue; }
    return { status: r.status, body: Buffer.from(await r.arrayBuffer()), hops, url: u };
  }
}
const REC = path.join(testDir, 'fixtures', 'github-attestation');
const SLSA = 'https://slsa.dev/provenance/v1';

// Sigstore's public-good trust root as the kit pins it (packageProvenance's SIGSTORE), read from the source
function pinnedRoot() {
  const a = SRC.indexOf('  const SIGSTORE = {');
  assert.ok(a >= 0, 'devteam.mjs pins SIGSTORE');
  const block = SRC.slice(a, SRC.indexOf('\n  };\n', a));
  const strings = [...block.matchAll(/'([A-Za-z0-9+/=]+)'/g)].map((m) => m[1]);
  return { fulcio: strings.slice(0, 2), rekor: { keyId: strings[2], spki: strings[3] } };
}

// A reference check of a tlog entry's Merkle inclusion proof (RFC 6962, as sigstore-js's
// verifyMerkleInclusion) and its checkpoint (a signed note, as sigstore-js's verifyCheckpoint): the
// test's own, so the fake's bundles and the recorded one are held to the same rules. Returns the first
// rule that fails, or null.
function tlogProof(entry, log) {
  const H = (...p) => crypto.createHash('sha256').update(Buffer.concat(p)).digest();
  const p = entry.inclusionProof;
  if (!p || !p.checkpoint || typeof p.checkpoint.envelope !== 'string') return 'no inclusion proof with a checkpoint';
  const idx = BigInt(p.logIndex), size = BigInt(p.treeSize);
  if (idx < 0n || idx >= size) return 'the proof\'s index is outside its tree';
  const bits = (n) => (n === 0n ? 0 : n.toString(2).length);
  const inner = bits(idx ^ (size - 1n));
  const border = [...(idx >> BigInt(inner)).toString(2)].filter((c) => c === '1').length;
  const hashes = p.hashes.map((h) => Buffer.from(h, 'base64'));
  if (hashes.length !== inner + border) return 'the proof has the wrong number of hashes';
  let acc = H(Buffer.from([0]), Buffer.from(entry.canonicalizedBody, 'base64'));
  hashes.slice(0, inner).forEach((h, i) => { acc = (idx >> BigInt(i)) & 1n ? H(Buffer.from([1]), h, acc) : H(Buffer.from([1]), acc, h); });
  for (const h of hashes.slice(inner)) acc = H(Buffer.from([1]), h, acc);
  const root = Buffer.from(p.rootHash, 'base64');
  if (!acc.equals(root)) return 'the proof does not lead to its root hash';
  const env = p.checkpoint.envelope;
  const cut = env.indexOf('\n\n');
  if (cut < 0) return 'the checkpoint is not a signed note';
  const note = env.slice(0, cut + 1);
  const [origin, sz, rh, ...rest] = note.split('\n');
  if (rest.join('') !== '') return 'the checkpoint is not a signed note';
  if (!origin.startsWith(`${log.name} - `)) return 'the checkpoint names another log';
  if (sz !== String(p.treeSize)) return 'the checkpoint\'s size is not the proof\'s';
  if (!Buffer.from(rh, 'base64').equals(root)) return 'the checkpoint\'s root is not the proof\'s';
  const sigs = [...env.slice(cut + 2).matchAll(/— (\S+) (\S+)\n/g)];
  const key = crypto.createPublicKey({ key: Buffer.from(log.spki, 'base64'), format: 'der', type: 'spki' });
  const hint = Buffer.from(log.keyId, 'hex').subarray(0, 4);
  const good = sigs.some((m) => { const raw = Buffer.from(m[2], 'base64'); return m[1] === log.name && raw.subarray(0, 4).equals(hint) && crypto.verify('sha256', Buffer.from(note), key, raw.subarray(4)); });
  return good ? null : 'the checkpoint is not signed by the log\'s key';
}
// the signed entry timestamp over the entry's global logIndex (kit-974's guard 9)
function setVerifies(entry, log) {
  const key = crypto.createPublicKey({ key: Buffer.from(log.spki, 'base64'), format: 'der', type: 'spki' });
  const set = JSON.stringify({ body: entry.canonicalizedBody, integratedTime: Number(entry.integratedTime), logID: log.keyId, logIndex: Number(entry.logIndex) });
  return crypto.verify('sha256', Buffer.from(set), key, Buffer.from(entry.inclusionPromise.signedEntryTimestamp, 'base64'));
}

// ---- H: the recorded real bundle ------------------------------------------------------------------

test('H1 test/fixtures/github-attestation/ holds a real attest-build-provenance bundle, and its shape is the one kit-install@2 reads', () => {
  const src = JSON.parse(fs.readFileSync(path.join(REC, 'source.json'), 'utf8'));
  assert.match(src.commands.join('\n'), /gh attestation download .* --repo cli\/cli --predicate-type https:\/\/slsa\.dev\/provenance\/v1/, 'H1 read with gh attestation download');
  const lines = fs.readFileSync(path.join(REC, 'bundle.jsonl'), 'utf8').split('\n').filter(Boolean);
  assert.equal(lines.length, 1, 'H1 one bundle');
  const b = JSON.parse(lines[0]);
  assert.equal(b.mediaType, 'application/vnd.dev.sigstore.bundle.v0.3+json', 'H1 a v0.3 bundle');
  const root = pinnedRoot();
  // the leaf: public-good Fulcio's, issued by the pinned intermediate, its SAN the workflow at its ref
  const leaf = new crypto.X509Certificate(Buffer.from(b.verificationMaterial.certificate.rawBytes, 'base64'));
  const int = new crypto.X509Certificate(Buffer.from(root.fulcio[0], 'base64'));
  assert.match(leaf.issuer, /O=sigstore\.dev[\s\S]*CN=sigstore-intermediate/, 'H1 the leaf is from O=sigstore.dev, CN=sigstore-intermediate');
  assert.ok(!leaf.ca && leaf.checkIssued(int) && leaf.verify(int.publicKey), 'H1 the leaf is issued by the pinned Fulcio intermediate');
  // the statement: SLSA v1, the workflow buildType, the workflow's ref, repository and path
  const env = b.dsseEnvelope;
  assert.equal(env.payloadType, 'application/vnd.in-toto+json', 'H1 an in-toto payload');
  assert.equal(env.signatures.length, 1, 'H1 one signature');
  const st = JSON.parse(Buffer.from(env.payload, 'base64').toString('utf8'));
  assert.equal(st._type, 'https://in-toto.io/Statement/v1', 'H1 an in-toto statement v1');
  assert.equal(st.predicateType, SLSA, 'H1 SLSA v1');
  const bd = st.predicate.buildDefinition;
  assert.equal(bd.buildType, 'https://actions.github.io/buildtypes/workflow/v1', 'H1 the workflow buildType');
  const w = bd.externalParameters.workflow;
  assert.deepEqual(Object.keys(w).sort(), ['path', 'ref', 'repository'], 'H1 externalParameters.workflow is { ref, repository, path }');
  assert.equal(leaf.subjectAltName, `URI:${w.repository}/${w.path}@${w.ref}`, 'H1 the SAN is the URI <repository>/<path>@<ref>');
  assert.match(bd.resolvedDependencies[0].digest.gitCommit, /^[0-9a-f]{40}$/, 'H1 resolvedDependencies[0].digest.gitCommit');
  // the subject: sha256 digests, the recorded asset's among them
  assert.ok(st.subject.length >= 1 && st.subject.every((s) => typeof s.name === 'string' && /^[0-9a-f]{64}$/.test(s.digest?.sha256 ?? '') && Object.keys(s.digest).length === 1), 'H1 every subject is a name and one sha256 digest');
  assert.ok(st.subject.some((s) => s.name === src.asset && s.digest.sha256 === src.asset_sha256), 'H1 the asset\'s sha256 is a subject');
  // the tlog entry: dsse, an inclusion promise, an inclusion proof whose index is shard-local
  const tl = b.verificationMaterial.tlogEntries;
  assert.equal(tl.length, 1, 'H1 one tlog entry');
  const e = tl[0];
  assert.deepEqual(e.kindVersion, { kind: 'dsse', version: '0.0.1' }, 'H1 a dsse 0.0.1 entry');
  assert.equal(Buffer.from(e.logId.keyId, 'base64').toString('hex'), root.rekor.keyId, 'H1 from the pinned Rekor log');
  assert.ok(e.inclusionPromise?.signedEntryTimestamp, 'H1 an inclusion promise');
  assert.ok(e.inclusionProof?.checkpoint?.envelope, 'H1 an inclusion proof with a checkpoint');
  assert.notEqual(String(e.inclusionProof.logIndex), String(e.logIndex), 'H1 inclusionProof.logIndex (shard-local) differs from the global logIndex');
  // and they hold: the proof, the checkpoint and the SET, with the pinned key
  const log = { name: 'rekor.sigstore.dev', keyId: root.rekor.keyId, spki: root.rekor.spki };
  assert.equal(tlogProof(e, log), null, 'H1 the inclusion proof and the checkpoint verify with the pinned key');
  assert.ok(setVerifies(e, log), 'H1 the signed entry timestamp verifies over the global logIndex');
  // the reference check is no rubber stamp: a flipped proof hash and another key are refused
  const flipped = structuredClone(e);
  const h0 = Buffer.from(flipped.inclusionProof.hashes[0], 'base64'); h0[0] ^= 1; flipped.inclusionProof.hashes[0] = h0.toString('base64');
  assert.equal(tlogProof(flipped, log), 'the proof does not lead to its root hash', 'H1 a broken proof is refused');
  const other = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }).publicKey.export({ type: 'spki', format: 'der' });
  assert.equal(tlogProof(e, { ...log, spki: other.toString('base64') }), 'the checkpoint is not signed by the log\'s key', 'H1 another key is refused');
  assert.equal(tlogProof({ ...e, inclusionProof: { ...e.inclusionProof, logIndex: e.logIndex } }, log), 'the proof\'s index is outside its tree', 'H1 the global index in the proof is refused');
});

// ---- F: the fake GitHub ---------------------------------------------------------------------------

// What a bundle from the fake holds, checked against the fake's trust root: null when it all holds, or
// the first part that doesn't
function bundleProblem(b, root, { version, bytes }) {
  const leaf = new crypto.X509Certificate(Buffer.from(b.verificationMaterial.certificate.rawBytes, 'base64'));
  const [int, ca] = root.fulcio.map((c) => new crypto.X509Certificate(Buffer.from(c, 'base64')));
  if (leaf.ca || !leaf.checkIssued(int) || !leaf.verify(int.publicKey) || !int.verify(ca.publicKey)) return 'the leaf does not chain to the test CA';
  const env = b.dsseEnvelope;
  const payload = Buffer.from(env.payload, 'base64');
  const pae = Buffer.concat([Buffer.from(`DSSEv1 ${Buffer.byteLength(env.payloadType)} ${env.payloadType} ${payload.length} `), payload]);
  if (env.signatures.length !== 1 || !crypto.verify('sha256', pae, leaf.publicKey, Buffer.from(env.signatures[0].sig, 'base64'))) return 'the DSSE signature does not hold';
  const st = JSON.parse(payload.toString('utf8'));
  if (st.predicateType !== SLSA || st.predicate.buildDefinition.buildType !== 'https://actions.github.io/buildtypes/workflow/v1') return 'not the attest-build-provenance statement';
  if (st.subject.length !== 1 || st.subject[0].name !== packName(NAME, version) || st.subject[0].digest.sha256 !== sha256(bytes)) return 'the subject is not the pack';
  const w = st.predicate.buildDefinition.externalParameters.workflow;
  if (w.repository !== `https://github.com/${REPO}` || w.path !== '.github/workflows/release.yml' || w.ref !== `refs/tags/v${version}`) return 'the statement is not release.yml at the tag';
  if (leaf.subjectAltName !== `URI:https://github.com/${REPO}/.github/workflows/release.yml@refs/tags/v${version}`) return 'the SAN is not release.yml at the tag';
  const tl = b.verificationMaterial.tlogEntries;
  if (tl.length !== 1 || tl[0].kindVersion.kind !== 'dsse') return 'not one dsse entry';
  const log = { name: root.rekor.name, keyId: root.rekor.keyId, spki: root.rekor.spki };
  if (!setVerifies(tl[0], log)) return 'the signed entry timestamp does not verify over the global logIndex';
  if (String(tl[0].inclusionProof?.logIndex) === String(tl[0].logIndex)) return 'the proof\'s index is the global one';
  return tlogProof(tl[0], log);
}

test('F1 the fake GitHub serves each version\'s pack and <pack>.sigstore.json through a stand-in redirect; the pack is the registry\'s tarball', async () => {
  const reg = await startFakeRegistry();
  try {
    assert.equal(reg.env({}).DEVTEAM_GITHUB_DOWNLOAD, reg.url, 'F1 env() names the fake as DEVTEAM_GITHUB_DOWNLOAD');
    for (const v of VERSIONS) {
      const pack = packName(NAME, v);
      assert.equal(pack, `sanctuarycomputer-devteam-${v}.tgz`, 'F1 npm pack\'s file name');
      const r = await download(reg, releaseUrl(REPO, v, pack));
      assert.equal(r.status, 200, `F1 the pack is served (${v})`);
      assert.deepEqual(r.hops.map((h) => new URL(h).hostname), ['release-assets.githubusercontent.com'], `F1 through one redirect to the stand-in (${v})`);
      assert.equal(sha256(r.body), sha256(tgzOf(v)), `F1 the pack is the registry's tarball, byte for byte (${v})`);
      const b = await download(reg, releaseUrl(REPO, v, `${pack}.sigstore.json`));
      assert.equal(b.status, 200, `F1 the bundle is served (${v})`);
      assert.equal(JSON.parse(b.body).mediaType, 'application/vnd.dev.sigstore.bundle.v0.3+json', `F1 a v0.3 bundle (${v})`);
    }
    assert.equal((await download(reg, releaseUrl('someone/else', '0.101.0', packName(NAME, '0.101.0')))).status, 404, 'F1 another repository has no release');
    assert.equal((await download(reg, releaseUrl(REPO, '9.9.9', packName(NAME, '9.9.9')))).status, 404, 'F1 another version has none');
  } finally { await reg.close(); }
});

test('F2 the fake\'s bundle is signed by the test CA, with a dsse entry, a SET over the global index, and an inclusion proof at a shard-local index with a signed checkpoint', async () => {
  const reg = await startFakeRegistry();
  try {
    const root = JSON.parse(fs.readFileSync(reg.caFile, 'utf8'));
    assert.equal(root.rekor.name, LOG_NAME, 'F2 the trust root names the log');
    for (const v of VERSIONS) {
      const b = JSON.parse((await download(reg, releaseUrl(REPO, v, `${packName(NAME, v)}.sigstore.json`))).body);
      // 0.99.0's provenance is the fixture's bad one (another repository), as on the registry
      assert.equal(bundleProblem(b, root, { version: v, bytes: tgzOf(v) }), v === '0.99.0' ? 'the statement is not release.yml at the tag' : null, `F2 the bundle holds (${v})`);
      const e = b.verificationMaterial.tlogEntries[0];
      assert.ok(Number(e.logIndex) > Number(e.inclusionProof.treeSize), `F2 the global logIndex is past the shard's tree (${v})`);
      const inner = (BigInt(e.inclusionProof.logIndex) ^ (BigInt(e.inclusionProof.treeSize) - 1n)).toString(2).length;
      assert.ok(inner > 0 && e.inclusionProof.hashes.length > inner, `F2 the proof has inner and border hashes (${v})`);
      assert.equal(typeof e.inclusionProof?.checkpoint?.envelope, 'string', `F2 the proof has a checkpoint (${v})`);
      assert.match(e.inclusionProof.checkpoint.envelope, new RegExp(`^${LOG_NAME.replace(/\./g, '\\.')} - \\d+\\n${e.inclusionProof.treeSize}\\n`), `F2 the checkpoint names the log and its size (${v})`);
    }
  } finally { await reg.close(); }
});

test('F3 each GitHub failure, driven once, serves what it says', async () => {
  const reg = await startFakeRegistry();
  const v = '0.101.0', pack = packName(NAME, v);
  const packUrl = releaseUrl(REPO, v, pack), bundleUrl = releaseUrl(REPO, v, `${pack}.sigstore.json`);
  const root = JSON.parse(fs.readFileSync(reg.caFile, 'utf8'));
  const statementOf = (b) => JSON.parse(Buffer.from(b.dsseEnvelope.payload, 'base64').toString('utf8'));
  const bundle = async () => JSON.parse((await download(reg, bundleUrl)).body);
  const asked = (n) => reg.requests().slice(n);
  try {
    const seen = new Set();
    const drive = async (name, fn) => { seen.add(name); await reg.githubFail(name); try { await fn(); } finally { await reg.githubFail(null); } };
    await drive('no-asset', async () => { assert.equal((await download(reg, packUrl)).status, 404, 'F3 no-asset: the pack is a 404'); assert.equal((await download(reg, bundleUrl)).status, 200, 'F3 no-asset: the bundle is still there'); });
    await drive('no-bundle', async () => { assert.equal((await download(reg, bundleUrl)).status, 404, 'F3 no-bundle: the bundle is a 404'); assert.equal((await download(reg, packUrl)).status, 200, 'F3 no-bundle: the pack is still there'); });
    await drive('digest', async () => { const b = await bundle(); assert.notEqual(statementOf(b).subject[0].digest.sha256, sha256(tgzOf(v)), 'F3 digest: another sha256'); assert.equal(bundleProblem(b, root, { version: v, bytes: tgzOf(v) }), 'the subject is not the pack', 'F3 digest: refused there'); });
    for (const [name, field, want] of [['repo', (w) => w.repository, 'https://github.com/someone-else/devteam'], ['workflow', (w) => w.path, '.github/workflows/other.yml'], ['ref', (w) => w.ref, 'refs/heads/main']]) {
      await drive(name, async () => {
        const b = await bundle();
        const w = statementOf(b).predicate.buildDefinition.externalParameters.workflow;
        assert.equal(field(w), want, `F3 ${name}: the statement names ${want}`);
        const leaf = new crypto.X509Certificate(Buffer.from(b.verificationMaterial.certificate.rawBytes, 'base64'));
        assert.equal(leaf.subjectAltName, `URI:${w.repository}/${w.path}@${w.ref}`, `F3 ${name}: the SAN follows the statement`);
      });
    }
    await drive('commit', async () => { const c = statementOf(await bundle()).predicate.buildDefinition.resolvedDependencies[0].digest.gitCommit; const want = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'registry', 'provenance.json'), 'utf8'))[v].commit; assert.ok(/^[0-9a-f]{40}$/.test(c) && c !== want, 'F3 commit: another commit'); });
    await drive('inclusion-proof', async () => assert.equal(bundleProblem(await bundle(), root, { version: v, bytes: tgzOf(v) }), 'the proof does not lead to its root hash', 'F3 inclusion-proof: the proof is broken'));
    await drive('checkpoint-key', async () => assert.equal(bundleProblem(await bundle(), root, { version: v, bytes: tgzOf(v) }), 'the checkpoint is not signed by the log\'s key', 'F3 checkpoint-key: another key'));
    await drive('checkpoint-root', async () => assert.equal(bundleProblem(await bundle(), root, { version: v, bytes: tgzOf(v) }), 'the checkpoint\'s root is not the proof\'s', 'F3 checkpoint-root: another root'));
    await drive('checkpoint-size', async () => assert.equal(bundleProblem(await bundle(), root, { version: v, bytes: tgzOf(v) }), 'the checkpoint\'s size is not the proof\'s', 'F3 checkpoint-size: another size'));
    await drive('checkpoint-origin', async () => assert.equal(bundleProblem(await bundle(), root, { version: v, bytes: tgzOf(v) }), 'the checkpoint names another log', 'F3 checkpoint-origin: another log'));
    await drive('no-inclusion-proof', async () => { const b = await bundle(); assert.equal(b.verificationMaterial.tlogEntries[0].inclusionProof, undefined, 'F3 no-inclusion-proof: none'); assert.equal(bundleProblem(b, root, { version: v, bytes: tgzOf(v) }), 'no inclusion proof with a checkpoint', 'F3 no-inclusion-proof: refused there'); });
    await drive('two-subjects', async () => { const b = await bundle(); assert.equal(statementOf(b).subject.length, 2, 'F3 two-subjects: two'); assert.equal(statementOf(b).subject[0].digest.sha256, sha256(tgzOf(v)), 'F3 two-subjects: the first is the pack'); assert.equal(bundleProblem(b, root, { version: v, bytes: tgzOf(v) }), 'the subject is not the pack', 'F3 two-subjects: refused there'); });
    await drive('replaced', async () => {
      const p = await download(reg, packUrl);
      assert.notEqual(sha256(p.body), sha256(tgzOf(v)), 'F3 replaced: other bytes');
      assert.equal(bundleProblem(await bundle(), root, { version: v, bytes: p.body }), null, 'F3 replaced: a bundle that holds for those bytes');
    });
    await drive('rate-limited', async () => { assert.equal((await download(reg, packUrl)).status, 429, 'F3 rate-limited: a 429'); });
    await drive('forbidden', async () => { const r = await download(reg, packUrl); assert.deepEqual([r.status, r.hops.length], [403, 1], 'F3 forbidden: the stand-in answers 403'); });
    await drive('no-answer', async () => { await assert.rejects(fetch(`${reg.url}-/githubusercontent/release-assets.githubusercontent.com/github-production-release-asset/${v}/${pack}`, { signal: AbortSignal.timeout(1500) }), /abort|timeout/i, 'F3 no-answer: never answered'); });
    await drive('drip', async () => {
      const ac = new AbortController();
      const r = await fetch(`${reg.url}-/githubusercontent/release-assets.githubusercontent.com/github-production-release-asset/${v}/${pack}`, { signal: ac.signal });
      assert.equal(r.status, 200, 'F3 drip: 200 at once');
      const rd = r.body.getReader();
      const t0 = Date.now(); let n = 0;
      while (n < 2) n += (await rd.read()).value.length;
      ac.abort();
      assert.ok(Date.now() - t0 >= 900, 'F3 drip: a byte a second');
    });
    for (const [name, hops] of [['hops-5', 5], ['hops-6', 6]]) await drive(name, async () => { const r = await download(reg, packUrl); assert.deepEqual([r.status, r.hops.length], [200, hops], `F3 ${name}: ${hops} redirects`); assert.ok(r.hops.every((h) => new URL(h).hostname.endsWith('.githubusercontent.com')), `F3 ${name}: each to a stand-in host`); });
    for (const [name, to] of [['redirect-elsewhere', /^https:\/\/evil\.example\//], ['redirect-http', /^http:\/\/release-assets\.githubusercontent\.com\//], ['redirect-lookalike', /^https:\/\/githubusercontent\.com\.evil\.example\//], ['redirect-loopback', /^http:\/\/127\.0\.0\.1:\d+\//], ['redirect-suffix', /^https:\/\/evilgithubusercontent\.com\//]]) {
      await drive(name, async () => { const r = await fetch(`${reg.url}${REPO}/releases/download/v${v}/${pack}`, { redirect: 'manual' }); assert.match(r.headers.get('location') ?? '', to, `F3 ${name}: the redirect's target`); });
    }
    const stand = `${reg.url}-/githubusercontent/release-assets.githubusercontent.com/github-production-release-asset/${v}/`;
    await drive('big-pack', async () => {
      const r = await fetch(`${stand}${pack}`);
      assert.equal(r.headers.get('content-length'), null, 'F3 big-pack: no content-length');
      let n = 0; for await (const c of r.body) n += c.length;
      assert.equal(n, 64 * 1024 * 1024 + 1, 'F3 big-pack: 64 MiB and one byte');
    });
    await drive('big-bundle', async () => { const ac = new AbortController(); const r = await fetch(`${stand}${pack}.sigstore.json`, { signal: ac.signal }); assert.equal(r.headers.get('content-length'), String(1024 * 1024 + 1), 'F3 big-bundle: 1 MiB and one byte declared'); ac.abort(); });
    await drive('bundle-at-cap', async () => { const b = await download(reg, bundleUrl); assert.equal(b.body.length, 1024 * 1024, 'F3 bundle-at-cap: exactly 1 MiB'); assert.equal(bundleProblem(JSON.parse(b.body), root, { version: v, bytes: tgzOf(v) }), null, 'F3 bundle-at-cap: still a good bundle'); });
    await drive('pack-at-cap', async () => {
      const r = await fetch(`${stand}${pack}`);
      assert.equal(r.headers.get('content-length'), String(64 * 1024 * 1024), 'F3 pack-at-cap: 64 MiB declared');
      let n = 0; for await (const c of r.body) n += c.length;
      assert.equal(n, 64 * 1024 * 1024, 'F3 pack-at-cap: exactly 64 MiB');
    });
    await drive('short-body', async () => {
      const r = await fetch(`${stand}${pack}`);
      assert.equal(r.headers.get('content-length'), String(tgzOf(v).length), 'F3 short-body: the whole length declared');
      await assert.rejects((async () => { for await (const c of r.body) void c; })(), 'F3 short-body: the connection closes mid-body');
    });
    assert.deepEqual([...seen].sort(), [...GITHUB_FAILURES].sort(), 'F3 every GitHub failure is driven');
    // FORGERIES apply to the GitHub bundle too; no-slsa serves npm's publish attestation as the asset
    await reg.forge('no-slsa');
    assert.notEqual(statementOf(await bundle()).predicateType, SLSA, 'F3 no-slsa: the asset is not SLSA provenance');
    await reg.forge(null);
    assert.equal(statementOf(await bundle()).predicateType, SLSA, 'F3 no-slsa: undone, the bundle is SLSA again');
    // FAILURES' outages stop GitHub's routes too
    await reg.fail('server-error');
    assert.equal((await download(reg, packUrl)).status, 503, 'F3 server-error: GitHub\'s routes are 503 too');
    await reg.fail(null);
    await assert.rejects(reg.githubFail('nope'), /no GitHub failure called nope/, 'F3 an unknown failure throws');
    assert.ok(asked(0).every((q) => 'authorization' in q && 'user-agent' in q), 'F3 each request logs its authorization and user-agent');
  } finally { await reg.close(); }
});

// ---- githubAsset (A1 to A9) ---------------------------------------------------------------------
// githubAsset has no command of its own (kit-1052 to kit-1054 call it), so a fixture instance's kit copy
// gains a probe, `package __github '<json>'`: a list of calls, { asset: [url, kind] } or { manifest:
// <file> }, each answered in turn, as JSON (bytes as their length and sha256, a throw as { thrown }).
// The real function, in a real instance, through the real CLI, with a HOME of its own, no DEVTEAM_* of
// the machine's, the fake's env() and tokens a leak would show.
const atmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-github-asset-'));
after(() => fs.rmSync(atmp, { recursive: true, force: true }));
let an = 0;
function ghInstance() {
  const base = path.join(atmp, `${++an}-instance`);
  fs.mkdirSync(base);
  const root = bareProject(base, 'gh');
  const f = path.join(root, 'docs', 'devteam', 'scripts', 'devteam.mjs');
  const src = fs.readFileSync(f, 'utf8');
  const at = 'function cmdPackage() {\n';
  assert.equal(src.split(at).length, 2, 'the kit declares cmdPackage once');
  const probe = `  if (positional[0] === '__github') {
    const res = [];
    for (const c of JSON.parse(positional[1])) {
      const t0 = Date.now();
      let r;
      try {
        r = c.asset ? githubAsset(...c.asset) : packManifest(fs.readFileSync(c.manifest));
        if (r && Buffer.isBuffer(r.bytes)) r = { ...r, bytes: { length: r.bytes.length, sha256: crypto.createHash('sha256').update(r.bytes).digest('hex') } };
      } catch (e) { r = { thrown: e.code ?? null, message: e.message }; }
      res.push({ ...r, ms: Date.now() - t0 });
    }
    return out(JSON.stringify({ res, rss: process.resourceUsage().maxRSS }));
  }
`;
  fs.writeFileSync(f, src.replace(at, () => at + probe));
  const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('DEVTEAM_') && !/^GIT_/.test(k)));
  clean.HOME = path.join(base, 'home');
  fs.mkdirSync(clean.HOME);
  clean.DEVTEAM_HUB_PORT = '4999';
  // what a leak would show
  Object.assign(clean, { GITHUB_TOKEN: 'ghp_leakedtoken1050', GH_TOKEN: 'gho_leakedtoken1050', HTTPS_PROXY: 'http://127.0.0.1:9/' });
  return { root, f, clean };
}
const GH_INST = ghInstance();
const ghEnv = (reg, extra = {}) => ({ ...reg.env(GH_INST.clean), ...extra });
const probeArgs = (calls) => [GH_INST.f, 'package', '__github', JSON.stringify(calls)];
function probe(calls, env) {
  const r = spawnSync(process.execPath, probeArgs(calls), { cwd: GH_INST.root, env, encoding: 'utf8', timeout: 280000, maxBuffer: 16 * 1024 * 1024 });
  assert.equal(r.status, 0, `the probe ran: ${r.stderr}`);
  return JSON.parse(r.stdout);
}
const asset = (u, kind = 'pack') => ({ asset: [u, kind] });
// the fake's requests on the paths githubAsset asks (the release download and the stand-in hosts): the
// fake listens on a loopback port of a shared machine, where another process may knock on it
const ghAsked = (reg) => reg.requests().filter((q) => q.url.startsWith(`/${REPO}/releases/download/`) || q.url.startsWith('/-/githubusercontent/'));
const V = '0.101.0', PACK = packName(NAME, V);
const PACK_URL = releaseUrl(REPO, V, PACK), BUNDLE_URL = releaseUrl(REPO, V, `${PACK}.sigstore.json`);

// A3: two slow calls, each on a fake of its own, started now and awaited by the file's last test, so
// their 15 s and 120 s overlap the other checks
const slow = ['no-answer', 'drip'].map((name) => (async () => {
  const reg = await startFakeRegistry({ githubFail: name });
  const t0 = Date.now();
  const r = await new Promise((resolve) => {
    const c = spawn(process.execPath, probeArgs([asset(PACK_URL)]), { cwd: GH_INST.root, env: ghEnv(reg), stdio: ['ignore', 'pipe', 'pipe'] });
    let so = '', se = '';
    c.stdout.on('data', (d) => { so += d; });
    c.stderr.on('data', (d) => { se += d; });
    const kill = setTimeout(() => c.kill('SIGKILL'), 200000);
    c.on('close', (code) => { clearTimeout(kill); resolve({ code, so, se }); });
  });
  await reg.close();
  return { name, wall: Date.now() - t0, ...r };
})());

test('A1 githubAsset follows the release download\'s redirect to its stand-in host, and returns the asset\'s bytes', async () => {
  const reg = await startFakeRegistry();
  try {
    const before = ghAsked(reg).length;
    const [a, b] = probe([asset(PACK_URL), asset(BUNDLE_URL, 'bundle')], ghEnv(reg)).res;
    assert.equal(a.ok, true, `A1 ok (${JSON.stringify(a).slice(0, 300)})`);
    assert.deepEqual(a.bytes, { length: tgzOf(V).length, sha256: sha256(tgzOf(V)) }, 'A1 the registry fixture\'s bytes');
    assert.equal(a.redirects, 1, 'A1 one redirect');
    assert.match(a.url, /^https:\/\/release-assets\.githubusercontent\.com\//, 'A1 url is the last URL asked, in its https form');
    for (const k of ['ok', 'unreachable', 'unpublished', 'refused', 'why', 'bytes', 'url', 'redirects']) assert.ok(k in a, `A1 the answer has ${k}`);
    assert.equal(b.ok, true, 'A1 the bundle too');
    const seen = ghAsked(reg).slice(before).map((q) => q.url);
    assert.equal(seen[0], `/${REPO}/releases/download/v${V}/${PACK}`, 'A1 the fake saw the release download first');
    assert.match(seen[1], /^\/-\/githubusercontent\/release-assets\.githubusercontent\.com\//, 'A1 then the stand-in');
  } finally { await reg.close(); }
});

test('A2 githubAsset follows at most 5 redirects', async () => {
  const reg = await startFakeRegistry();
  try {
    await reg.githubFail('hops-5');
    const [five] = probe([asset(PACK_URL)], ghEnv(reg)).res;
    assert.deepEqual([five.ok, five.redirects], [true, 5], 'A2 five hops are followed');
    await reg.githubFail('hops-6');
    const [six] = probe([asset(PACK_URL)], ghEnv(reg)).res;
    assert.equal(six.refused, 'redirects', 'A2 a sixth is refused');
  } finally { await reg.close(); }
});

test('A4 a redirect anywhere but https to github.com or a githubusercontent.com host is refused, and not followed', async () => {
  const reg = await startFakeRegistry();
  try {
    for (const name of ['redirect-elsewhere', 'redirect-http', 'redirect-lookalike', 'redirect-loopback', 'redirect-suffix']) {
      await reg.githubFail(name);
      const before = ghAsked(reg).length;
      const [r] = probe([asset(PACK_URL)], ghEnv(reg)).res;
      assert.equal(r.refused, 'redirect', `A4 ${name} is refused`);
      assert.equal(ghAsked(reg).length - before, 1, `A4 ${name}: no request past the first`);
    }
  } finally { await reg.close(); }
});

test('A5 a URL that isn\'t exactly https on github.com is refused before any request, in test mode too', async () => {
  const reg = await startFakeRegistry();
  try {
    const bad = [
      `http://github.com/${REPO}/releases/download/v${V}/${PACK}`, `https://evil.example/${REPO}/releases/download/v${V}/${PACK}`,
      `https://github.com:8443/${REPO}/releases/download/v${V}/${PACK}`, `https://x@github.com/${REPO}/releases/download/v${V}/${PACK}`,
      `https://GITHUB.com/${REPO}/releases/download/v${V}/${PACK}`, `ftp://github.com/${REPO}/releases/download/v${V}/${PACK}`,
      `https://github.com/${'a'.repeat(2048)}`, 42,
    ];
    const before = ghAsked(reg).length;
    const res = probe(bad.map((u) => asset(u)), ghEnv(reg)).res;
    bad.forEach((u, i) => assert.equal(res[i].refused, 'url', `A5 ${String(u).slice(0, 60)} is refused url`));
    assert.equal(ghAsked(reg).length, before, 'A5 no request for any of them');
    // a kind is one of the two words, never a name another object answers to
    const kinds = ['tarball', 'constructor', '__proto__', 'toString', 'hasOwnProperty', 'Pack'];
    probe(kinds.map((kind) => ({ asset: [PACK_URL, kind] })), ghEnv(reg)).res.forEach((r, i) => assert.equal(r.refused, 'input', `A5 a kind that is not pack or bundle is refused input: ${kinds[i]}`));
    // the URL's bound is 2048 characters
    const long = (n) => `https://github.com/${REPO}/releases/download/v${V}/${'a'.repeat(n - `https://github.com/${REPO}/releases/download/v${V}/`.length)}`;
    const [at, past] = probe([asset(long(2048)), asset(long(2049))], ghEnv(reg)).res;
    assert.notEqual(at.refused, 'url', 'A5 a URL of 2048 characters is not refused url');
    assert.equal(past.refused, 'url', 'A5 a URL of 2049 characters is refused url');
  } finally { await reg.close(); }
});

test('A6 no answer, a 5xx or a 429 is unreachable; a 404 is unpublished; any other status is refused', async () => {
  const reg = await startFakeRegistry();
  try {
    const one = () => probe([asset(PACK_URL)], ghEnv(reg)).res[0];
    await reg.fail('unreachable');
    assert.equal(one().unreachable, true, 'A6 reset connections are unreachable');
    await reg.fail('server-error');
    assert.equal(one().unreachable, true, 'A6 a 503 is unreachable');
    await reg.fail(null);
    await reg.githubFail('rate-limited');
    assert.equal(one().unreachable, true, 'A6 rate-limited is unreachable');
    await reg.githubFail('no-asset');
    assert.equal(one().unpublished, true, 'A6 no-asset is unpublished');
    await reg.githubFail('forbidden');
    assert.equal(one().refused, 'status', 'A6 a 403 is refused status');
  } finally { await reg.close(); }
});

test('A7 a pack is at most 64 MiB and a bundle at most 1 MiB; a body cut short is never ok', async () => {
  const reg = await startFakeRegistry();
  try {
    const one = (kind, u = kind === 'pack' ? PACK_URL : BUNDLE_URL) => probe([asset(u, kind)], ghEnv(reg));
    const base = one('pack');
    await reg.githubFail('big-pack');
    const big = one('pack');
    assert.equal(big.res[0].refused, 'too-big', 'A7 a pack over 64 MiB is refused too-big');
    assert.ok(big.rss < base.rss + 32 * 1024, `A7 the probe never holds the body (${big.rss} KiB against ${base.rss})`);
    await reg.githubFail('pack-at-cap');
    const cap = one('pack').res[0];
    assert.deepEqual([cap.ok, cap.bytes?.length, cap.bytes?.sha256], [true, 64 * 1024 * 1024, sha256(Buffer.alloc(64 * 1024 * 1024))], 'A7 a pack of exactly 64 MiB is ok');
    await reg.githubFail('big-bundle');
    const bb = one('bundle').res[0];
    assert.equal(bb.refused, 'too-big', 'A7 a bundle declared over 1 MiB is refused too-big');
    assert.match(bb.why, /declares/, 'A7 refused by its declared length, before reading');
    await reg.githubFail('bundle-at-cap');
    assert.deepEqual([one('bundle').res[0].ok, one('bundle').res[0].bytes.length], [true, 1024 * 1024], 'A7 a bundle of exactly 1 MiB is ok');
    await reg.githubFail('short-body');
    const short = one('pack').res[0];
    assert.deepEqual([short.ok, short.unreachable], [false, true], 'A7 a body cut short is unreachable');
  } finally { await reg.close(); }
});

test('A8 no request carries an Authorization header, every one says user-agent devteam, and the fetch\'s child gets an empty environment', async () => {
  const reg = await startFakeRegistry();
  try {
    const marks = path.join(atmp, 'marks.jsonl');
    const marker = path.join(atmp, 'marker.cjs');
    fs.writeFileSync(marker, `require('node:fs').appendFileSync(${JSON.stringify(marks)}, JSON.stringify({ argv: process.argv.slice(1, 2), exec: process.execArgv.slice(0, 1) }) + '\\n');\n`);
    probe([asset(PACK_URL), asset(BUNDLE_URL, 'bundle')], ghEnv(reg));
    for (const name of ['hops-5', 'redirect-loopback', 'rate-limited', 'forbidden', 'short-body']) { await reg.githubFail(name); probe([asset(PACK_URL)], ghEnv(reg)); }
    await reg.githubFail(null);
    const asked = ghAsked(reg);
    assert.ok(asked.length >= 12, `A8 the fake saw the probes (${asked.length})`);
    assert.ok(asked.every((q) => q.authorization === null), 'A8 no request carried an Authorization header');
    assert.ok(asked.every((q) => q['user-agent'] === 'devteam'), 'A8 every request says user-agent devteam');
    const [r] = probe([asset(PACK_URL)], ghEnv(reg, { NODE_OPTIONS: `--require ${marker}` })).res;
    assert.equal(r.ok, true, 'A8 the marked run fetched');
    const seen = fs.readFileSync(marks, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    assert.ok(seen.some((m) => /devteam\.mjs$/.test(m.argv[0] ?? '')), 'A8 the marker saw the CLI\'s process');
    assert.ok(!seen.some((m) => m.exec[0] === '-e' || m.argv.length === 0), 'A8 the child\'s environment is empty');
  } finally { await reg.close(); }
});

test('A9 DEVTEAM_GITHUB_DOWNLOAD must be exactly a loopback http origin, or githubAsset throws before any request', async () => {
  const reg = await startFakeRegistry();
  try {
    const p = reg.port;
    const before = ghAsked(reg).length;
    for (const v of [`http://localhost:${p}/`, `http://[::1]:${p}/`, `https://127.0.0.1:${p}/`, `http://127.0.0.1:${p}`, `http://127.0.0.1:${p}/x/`, 'http://127.0.0.1:0/', 'http://127.0.0.1:65536/', 'http://127.0.0.1:080/']) {
      const [r] = probe([asset(PACK_URL)], ghEnv(reg, { DEVTEAM_GITHUB_DOWNLOAD: v })).res;
      assert.equal(r.thrown, 'EDEVTEAMGITHUB', `A9 ${v} throws`);
    }
    assert.equal(ghAsked(reg).length, before, 'A9 before any request');
    // empty is the same as unset: github.com itself; a URL refused before any request keeps it off the network
    const [e] = probe([asset('https://evil.example/x')], ghEnv(reg, { DEVTEAM_GITHUB_DOWNLOAD: '' })).res;
    assert.deepEqual([e.thrown, e.refused], [undefined, 'url'], 'A9 empty is the same as unset');
  } finally { await reg.close(); }
});

// ---- packManifest (M1 to M6) --------------------------------------------------------------------
// Each pack is written to a file and read by the probe's { manifest: <file> }: the real function, in the
// fixture instance, through the real CLI. The packs come from a tar writer of this file's: ustar headers
// as npm pack writes them, or with one field written another way. Each case is named by its class only.
const mtmp = path.join(atmp, 'packs');
fs.mkdirSync(mtmp);
let pn = 0;
const packFile = (bytes) => { const f = path.join(mtmp, `${++pn}.tgz`); fs.writeFileSync(f, bytes); return f; };
// many packs in one CLI run
const manifests = (packs) => probe(packs.map((b) => ({ manifest: packFile(b) })), GH_INST.clean).res;
const sumOf = (h) => { let s = 0; for (let i = 0; i < 512; i++) s += i >= 148 && i < 156 ? 32 : h[i]; return s; };
const sumFix = (h) => { h.write(`${sumOf(h).toString(8).padStart(6, '0')}\0 `, 148, 8, 'latin1'); return h; };
function header({ name = '', nameraw, type = '0', size = 0, prefix = '', linkname = '', linkraw, magic = 'ustar\u000000', cks = 'std', base256 = false, b475 = 0 }) {
  const h = Buffer.alloc(512);
  if (nameraw) nameraw.copy(h, 0); else h.write(name, 0, 100, 'utf8');
  h.write('0000644\0', 100); h.write('0000000\0', 108); h.write('0000000\0', 116);
  if (base256) { h[124] = 0x80; h.writeUInt32BE(size, 132); } else h.write(`${size.toString(8).padStart(11, '0')}\0`, 124);
  h.write('00000000000\0', 136);
  h.write(type, 156, 1, 'latin1');
  if (linkraw) linkraw.copy(h, 157); else if (linkname) h.write(linkname, 157, 100, 'utf8');
  h.write(magic, 257, 8, 'latin1');
  h.write(prefix, 345, 155, 'utf8');
  if (b475) h[475] = b475;
  const s = sumOf(h) + (cks === 'bad' ? 1 : 0);
  if (cks === '8') h.write(s.toString(8).padStart(8, '0'), 148, 8, 'latin1');
  else h.write(`${s.toString(8).padStart(6, '0')}\0 `, 148, 8, 'latin1');
  return h;
}
const pad = (b, fill = 0) => Buffer.concat([b, Buffer.alloc((512 - (b.length % 512)) % 512, fill)]);
const rec = (k, v) => { const r = ` ${k}=${v}\n`; let n = Buffer.byteLength(r); n += String(n + String(n).length).length; return `${n}${r}`; };
const paxOf = (kv) => Buffer.from(Object.entries(kv).map(([k, v]) => rec(k, v)).join(''));
const entry = (o) => { const body = o.body ?? Buffer.alloc(0); return Buffer.concat([header({ ...o, size: o.size ?? body.length }), pad(body)]); };
const file = (name, body) => entry({ name, body: Buffer.isBuffer(body) ? body : Buffer.from(body) });
const paxEntry = (kv, type = 'x') => entry({ name: 'PaxHeader/x', type, body: Buffer.isBuffer(kv) ? kv : paxOf(kv) });
const END = Buffer.alloc(1024);
const tgz = (...parts) => zlib.gzipSync(Buffer.concat([...parts, END]));
const PKG = (o = {}) => Buffer.from(JSON.stringify({ name: NAME, version: '1.2.3', devteam: { layout: 2 }, ...o }));
const MA = PKG(), MB = PKG({ version: '6.6.6', dependencies: { evil: '1' } });
const PJ = 'package/package.json';
const SHEBANG = '#!/usr/bin/env node\nx\n';
const KINDS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies', 'bundleDependencies', 'bundledDependencies'];
const fourOf = (j) => j && { name: j.name ?? null, version: j.version ?? null, layout: j.devteam?.layout ?? null, dependencies: Object.fromEntries(KINDS.filter((k) => k in j).map((k) => [k, j[k]])) };
const treeOf = (d) => {
  const tree = [];
  const walk = (rel) => { for (const nm of fs.readdirSync(path.join(d, rel))) { const r = rel ? `${rel}/${nm}` : nm; if (fs.lstatSync(path.join(d, r)).isDirectory()) walk(r); else { const b = fs.readFileSync(path.join(d, r)); tree.push({ path: r, size: b.length, sha256: sha256(b) }); } } };
  walk('');
  return tree.sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0));
};
// every pack M1 to M5 reads, kept for M6: [label, bytes, answer, { split, alt }]
const BUILT = [];
const read = (label, packs) => { const res = manifests(packs.map(([, b]) => b)); packs.forEach(([l, b, o], i) => BUILT.push([`${label} ${l}`, b, res[i], o ?? {}])); return res; };
const FIX = (v) => path.join(FIXTURES, 'registry', `devteam-${v}.tgz`);

test('M1 packManifest reads the pack\'s own package.json: name, version, layout, every dependency kind, its files and its bins', () => {
  const fx = VERSIONS.map((v) => [v, fs.readFileSync(FIX(v))]);
  const res = read('fixture', fx);
  fx.forEach(([v], i) => {
    const r = res[i];
    assert.equal(r.ok, true, `M1 the fixture ${v} is read (${JSON.stringify(r).slice(0, 200)})`);
    const j = JSON.parse(execFileSync('tar', ['-xOzf', FIX(v), PJ]));
    assert.deepEqual(r.manifest, { name: NAME, version: v, layout: j.devteam?.layout ?? null, dependencies: {} }, `M1 the fixture ${v}'s manifest`);
    const d = path.join(mtmp, `tar-${v}`);
    fs.mkdirSync(d);
    execFileSync('tar', ['-xzf', FIX(v), '-C', d]);
    const listed = execFileSync('tar', ['-tzf', FIX(v)], { encoding: 'utf8' }).split('\n').filter((n) => n.startsWith('package/') && !n.endsWith('/')).map((n) => n.slice(8)).sort();
    assert.deepEqual(r.files.map((f) => f.path), listed, `M1 the fixture ${v}'s files are tar's list`);
    assert.deepEqual(r.files, treeOf(path.join(d, 'package')), 'M1 files are tar\'s list with sizes and sha256');
    assert.deepEqual(r.bins, j.devteam?.layout === 2 ? { devteam: 'docs/devteam/scripts/cli.mjs' } : {}, j.devteam?.layout === 2 ? 'M1 the layout-2 fixture is read' : `M1 the fixture ${v} has no bins`);
  });
  assert.ok(res.some((r) => r.manifest?.layout === 2), 'M1 the layout-2 fixture is read');
  const all = { dependencies: { a: '1' }, devDependencies: { b: '2' }, optionalDependencies: { c: '3' }, peerDependencies: { d: '4' }, bundleDependencies: ['a'], bundledDependencies: ['a'] };
  const [kinds, none, paxed, pathBin, objBin] = read('M1', [
    ['kinds', tgz(file(PJ, PKG({ ...all, scripts: { x: 'y' }, other: 1 })))],
    ['no layout', tgz(file(PJ, PKG({ devteam: undefined })))],
    ['pax-named', tgz(file(PJ, MA), paxEntry({ path: `package/${'d'.repeat(120)}/f.js` }), file('package/short.js', 'long'))],
    ['path bin', tgz(file(PJ, PKG({ bin: './cli.mjs' })), file('package/cli.mjs', SHEBANG))],
    ['object bin', tgz(file(PJ, PKG({ bin: { dt: 'cli.mjs', other: './lib/o.js' } })), file('package/cli.mjs', SHEBANG), file('package/lib/o.js', SHEBANG))],
  ]);
  assert.deepEqual(kinds.manifest?.dependencies, all, 'M1 every dependency kind, each with its value, and nothing else');
  assert.equal(none.manifest?.layout, null, 'M1 a manifest without a layout reads null');
  assert.deepEqual(paxed.files?.map((f) => f.path), [`${'d'.repeat(120)}/f.js`, 'package.json'], 'M1 a pax-named file is listed by its path');
  assert.deepEqual(paxed.files?.[0], { path: `${'d'.repeat(120)}/f.js`, size: 4, sha256: sha256(Buffer.from('long')) }, 'M1 files are tar\'s list with sizes and sha256');
  assert.deepEqual(pathBin.bins, { devteam: 'cli.mjs' }, 'M1 a path bin is keyed by the name after its scope');
  assert.deepEqual(objBin.bins, { dt: 'cli.mjs', other: 'lib/o.js' }, 'M1 an object of bins is read as npm links them');
});

test('M2 a pack without package/package.json, or with a bin npm would not link as it is, is refused', () => {
  const cases = [
    ['no manifest', tgz(file('package/other.json', MA), file('package/x.js', 'x')), 'no-manifest'],
    ['a manifest at another path', tgz(file('package/PACKAGE.json', MA)), 'manifest-path'],
    ['a manifest outside package/', tgz(file('x/package.json', MA)), 'name'],
    ['a bin naming no file', tgz(file(PJ, PKG({ bin: { devteam: 'nope.mjs' } }))), 'bin'],
    ['a bin npm would rewrite', tgz(file(PJ, PKG({ bin: { devteam: 'cli.mjs' } })), file('package/cli.mjs', '#!/usr/bin/env node\r\nx\n')), 'bin'],
    ['a bin key that is not a plain name', tgz(file(PJ, PKG({ bin: { '../x': 'cli.mjs' } })), file('package/cli.mjs', SHEBANG)), 'bin'],
    ['two bin keys but for case', tgz(file(PJ, PKG({ bin: { Dev: 'cli.mjs', dev: 'cli.mjs' } })), file('package/cli.mjs', SHEBANG)), 'bin'],
    ['a bin folder', tgz(file(PJ, PKG({ directories: { bin: 'b' } })), file('package/b/x', SHEBANG)), 'bin'],
  ];
  const res = read('M2', cases);
  cases.forEach(([label, , want], i) => assert.equal(res[i].refused, want, `M2 ${label} is refused (${JSON.stringify(res[i]).slice(0, 160)})`));
  assert.equal(res[0].refused, 'no-manifest', 'M2 no manifest is refused');
  assert.equal(res[4].refused, 'bin', 'M2 a bin npm would rewrite is refused');
});

test('M3 each way npm\'s tar would install another package.json, or read the archive otherwise, is refused', () => {
  const cover = (o) => Buffer.concat([header({ name: 'package/R.md', size: 1024, ...o }), file(PJ, MB)]);
  const nfc = 'package/d/\u00e9.js', nfd = 'package/d/e\u0301.js';
  const classes = {
    // another package.json over the manifest
    'another manifest': [[tgz(file(PJ, MA), file(PJ, MB)), 'two-manifests'], [tgz(file(PJ, MA), paxEntry({ path: PJ }), file('package/o.txt', MB)), 'two-manifests'],
      [tgz(file(PJ, MA), entry({ name: 'package.json', prefix: 'package', body: MB })), 'two-manifests'], [tgz(file(PJ, MA), file('package/PACKAGE.json', MB)), 'two-manifests'],
      [tgz(file(PJ, MA), paxEntry({ path: 'package/o.txt' }), file(PJ, MB)), 'two-manifests']],
    // a name npm's tar reads as another path
    'a name read another way': ['x/package.json', 'package/./package.json', '//package.json', '///package.json', 'c:package.json', '//?/C:/package.json', 'package\\package.json', 'package/c:package.json', 'package']
      .map((n) => [tgz(file(PJ, MA), file(n, MB)), 'name']).concat([[tgz(file(PJ, MA), Buffer.concat([header({ name: '', size: 1024 }), file(PJ, MB)])), 'name']]),
    // a header type npm pack does not write
    'an entry type npm pack does not write': [[tgz(file(PJ, MA), entry({ name: '././@LongLink', type: 'L', body: Buffer.from(`${PJ}\0`) }), file('package/zzz', MB)), 'entry-type'],
      [tgz(file(PJ, MA), entry({ name: '././@LongLink', type: 'K', body: Buffer.from('x\0') }), cover()), 'entry-type'],
      [tgz(file(PJ, MA), paxEntry({ path: PJ }, 'X'), file('package/o.txt', MB)), 'entry-type'], [tgz(paxEntry({ comment: 'c' }, 'g'), file(PJ, MA)), 'entry-type']],
    'a link': [[tgz(file(PJ, MA), cover({ linkname: 'x' })), 'link'], [tgz(file(PJ, MA), paxEntry({ linkpath: 'x' }), cover()), 'link']],
    // a header npm's tar skips, or an archive it reads past
    'a header npm skips or reads past': [[tgz(file(PJ, MA), cover({ cks: 'bad' })), 'tar'], [tgz(file(PJ, MA), cover({ type: '5', name: 'package/d/' })), 'tar'],
      [zlib.gzipSync(Buffer.concat([file(PJ, MA), Buffer.alloc(512), file(PJ, MB), END])), 'tar'], [zlib.gzipSync(Buffer.concat([file(PJ, MA), Buffer.alloc(512)])), 'tar'],
      [zlib.gzipSync(file(PJ, MA)), 'tar'], [zlib.gzipSync(Buffer.concat([file(PJ, MA), END, file(PJ, MB), END])), 'tar'], [tgz(entry({ name: PJ, body: MA, magic: 'ustar  \0' })), 'tar']],
    // a header field npm's tar decodes another way
    'a field npm decodes another way': [
      [tgz(file(PJ, MA), paxEntry(Buffer.from(rec('path', 'package/x\n.js'))), file(PJ, MB)), 'tar'],
      [tgz(file(PJ, MA), paxEntry(Buffer.from(rec('comment', `c\n${(() => { const r = ' path=package/package.json'; let k = Buffer.byteLength(r) + 1; k += String(k).length; return `${k}${r}`; })()}`))), file('package/o.txt', MB)), 'tar'],
      [tgz(file(PJ, MA), paxEntry((() => { const r = Buffer.concat([Buffer.from(' path=package/x'), Buffer.from([0xff]), Buffer.from('.js\n')]); return Buffer.concat([Buffer.from(String(r.length + String(r.length + 2).length)), r]); })()), file(PJ, MB)), 'tar'],
      [tgz(file(PJ, MA), cover({ cks: '8' })), 'tar'], [tgz(entry({ name: PJ, body: MA, cks: '8' })), 'tar'],
      [tgz(file(PJ, MA), cover({ linkraw: Buffer.from('\0\nx') })), 'link'],
      [tgz(file(PJ, MA), entry({ name: '', type: 'x', body: paxOf({ mtime: '1' }) }), file('package/z.txt', 'z')), 'tar'],
      [tgz(file(PJ, MA), paxEntry({ size: '512' }), paxEntry({ mtime: '1' }), file('package/z.txt', Buffer.alloc(512, 120))), 'tar'],
      [tgz(paxEntry({ size: '0' }), cover(), file('package/z.txt', '')), 'tar'],
      [tgz(entry({ name: PJ, body: MA, b475: 0x31 })), 'tar']],
    // a name npm pack does not write
    'a name npm pack does not write': [[tgz(file(PJ, MA), file('package/\u00e9.js', 'x')), 'name'], [tgz(file(PJ, MA), file('package/.gitignore', 'x')), 'name'],
      [tgz(file(PJ, MA), file('package/d/.npmignore', 'x')), 'name'], [tgz(file(PJ, MA), file('package/a\\b.js', 'x')), 'name'], [tgz(file(PJ, MA), file('package/d/node_modules/a/package.json', MB)), 'name']],
    'a duplicate': [[tgz(file(PJ, MA), file('package/a.js', 'x'), file('package/a.js', 'y')), 'duplicate'], [tgz(file(PJ, MA), file('package/a.js', 'x'), file('package/A.js', 'y')), 'duplicate'],
      [tgz(file(PJ, MA), file(nfc, 'x'), file(nfd, 'y')), 'duplicate'], [tgz(file(PJ, MA), file('package/a', 'x'), file('package/a/b', 'y')), 'duplicate'],
      [tgz(file(PJ, MA), file('package/a.js', 'x'), paxEntry({ path: 'package/b.js' }), file('package/a.js', 'y')), 'duplicate'],
      [tgz(file(PJ, MA), file('package/a/b', 'x'), paxEntry({ path: 'package/c.js' }), file('package/a', 'y')), 'duplicate']],
  };
  const flat = Object.entries(classes).flatMap(([cls, list]) => list.map(([b, want], i) => [`${cls} (${i + 1})`, b, want, cls]));
  const res = read('M3', flat);
  flat.forEach(([label, , want, cls], i) => assert.equal(res[i].refused, want, `M3 ${cls} is refused: ${label} (${JSON.stringify(res[i]).slice(0, 160)})`));
  // a pax size over bytes that look like a header is one entry, as npm reads it
  const hidden = file(PJ, MB);
  const [one] = read('M3', [['a pax size over a header', tgz(file(PJ, MA), paxEntry({ size: String(hidden.length) }), entry({ name: 'package/R.md', body: hidden }))]]);
  assert.deepEqual([one.ok, one.manifest?.version, one.files?.map((f) => f.path)], [true, '1.2.3', ['R.md', 'package.json']], 'M3 a pax size over bytes that look like a header is one entry');
});

test('M4 package/package.json that is not a regular file is refused', () => {
  const cases = [['a symlink manifest', '2', 'entry-type'], ['a hard-link manifest', '1', 'entry-type'], ['a FIFO manifest', '6', 'entry-type'], ['a type-7 manifest', '7', 'entry-type'], ['a NUL-type manifest', '\0', 'entry-type']];
  const res = read('M4', cases.map(([l, type]) => [l, tgz(entry({ name: PJ, type, body: type === '2' || type === '1' ? undefined : MA, linkname: type === '2' || type === '1' ? 'x' : '' }))]));
  cases.forEach(([l, , want], i) => assert.equal(res[i].refused, want, `M4 ${l} is refused`));
  const [dir, reg] = read('M4', [['a folder manifest', tgz(entry({ name: `${PJ}/`, type: '5' }))], ['a regular manifest', tgz(entry({ name: 'package/', type: '5' }), file(PJ, MA))]]);
  assert.equal(dir.refused, 'manifest-path', 'M4 a folder manifest is refused manifest-path');
  assert.equal(reg.ok, true, 'M4 a regular manifest is read');
});

test('M5 each bound: the pack, what it unzips to, the manifest, a pax record; one gzip member; a whole archive; a JSON object', async () => {
  const MIB = 1024 * 1024;
  // the bomb: over 256 MiB of zeros, streamed through gzip, never held
  const bomb = path.join(mtmp, 'bomb.tgz');
  await new Promise((resolve, reject) => {
    const z = zlib.createGzip();
    const w = fs.createWriteStream(bomb);
    z.pipe(w);
    w.on('finish', resolve);
    w.on('error', reject);
    const chunk = Buffer.alloc(MIB);
    let left = 257;
    const more = () => { while (left > 0) { left--; if (!z.write(chunk)) return z.once('drain', more); } z.end(); };
    more();
  });
  const big = path.join(mtmp, 'big.tgz');
  fs.writeFileSync(big, Buffer.alloc(64 * MIB + 1));
  const [over, unzipped] = probe([{ manifest: big }, { manifest: bomb }], GH_INST.clean).res;
  assert.equal(over.refused, 'too-big', 'M5 a pack over 64 MiB is refused too-big');
  assert.equal(unzipped.refused, 'too-big', 'M5 a pack that unzips past 256 MiB is refused too-big');
  const t1 = Buffer.concat([file(PJ, MA), END]);
  const g1 = zlib.gzipSync(t1);
  const isize = Buffer.alloc(4);
  isize.writeUInt32LE(t1.length);
  const at64 = Buffer.concat([g1, Buffer.alloc(64 * 1024 - g1.length)]);
  const cases = [
    ['a manifest over 1 MiB', tgz(file(PJ, PKG({ x: 'a'.repeat(MIB) }))), 'too-big'],
    ['a pax record over 1 MiB', tgz(file(PJ, MA), paxEntry({ path: `package/${'a'.repeat(MIB)}` }), file('package/a', 'x')), 'too-big'],
    ['not gzip', Buffer.concat([file(PJ, MA), END]), 'gzip'],
    ['bytes after the gzip data', Buffer.concat([g1, Buffer.alloc(1024)]), 'gzip'],
    ['bytes after the gzip data, ending as one member would', Buffer.concat([g1, Buffer.alloc(1020), isize]), 'gzip'],
    ['a second member after padding', Buffer.concat([at64, zlib.gzipSync(Buffer.concat([file(PJ, MB), END]))]), 'gzip'],
    ['two members', Buffer.concat([zlib.gzipSync(file(PJ, MA)), zlib.gzipSync(Buffer.concat([file('package/x.js', 'x'), END]))]), 'gzip'],
    ['a bad checksum', tgz(entry({ name: PJ, body: MA, cks: 'bad' })), 'tar'],
    ['a base-256 size', tgz(entry({ name: PJ, body: MA, base256: true })), 'tar'],
    ['a cut archive', zlib.gzipSync(Buffer.concat([file(PJ, MA)]).subarray(0, 700)), 'tar'],
    ['a bad pax record', tgz(paxEntry(Buffer.from('garbage\n')), file(PJ, MA)), 'tar'],
    ['not JSON', tgz(file(PJ, '{"name":')), 'json'],
    ['a JSON array', tgz(file(PJ, '[1]')), 'json'],
  ];
  const res = read('M5', cases);
  cases.forEach(([l, , want], i) => assert.equal(res[i].refused, want, `M5 ${l} is refused ${want} (${JSON.stringify(res[i]).slice(0, 160)})`));
  const [empty] = probe([{ manifest: packFile(Buffer.alloc(0)) }], GH_INST.clean).res;
  assert.equal(empty.refused, 'input', 'M5 no bytes is refused input');
});

test('M6 wherever packManifest reads a pack, npm\'s own tar installs that manifest and exactly those files', async () => {
  const ntar = createRequire(import.meta.url)(path.join(path.dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'node_modules', 'tar'));
  // pacote's options: strip 1, no chmod or mtime, links dropped, only files written
  const PACOTE = { strip: 1, noChmod: true, noMtime: true, filter: (n, e) => { if (/Link$/.test(e.type)) return false; e.mode = (e.mode | (/Directory|GNUDumpDir/.test(e.type) ? 0o777 : /File$/.test(e.type) ? 0o666 : 0)) | 0o600; return /File$/.test(e.type); } };
  let xn = 0;
  const installs = async (gz, chunk = 0) => {
    const d = path.join(mtmp, `npm-${++xn}`);
    fs.mkdirSync(d);
    if (!chunk) { const f = `${d}.tgz`; fs.writeFileSync(f, gz); try { ntar.x({ ...PACOTE, sync: true, cwd: d, file: f }); } catch {} }
    else await new Promise((res) => { const x = ntar.x({ ...PACOTE, cwd: d }); x.on('close', res); x.on('error', res); for (let i = 0; i < gz.length; i += chunk) x.write(gz.subarray(i, i + chunk)); x.end(); });
    let j = null;
    try { j = JSON.parse(fs.readFileSync(path.join(d, 'package.json'), 'utf8')); } catch {}
    const out = { manifest: fourOf(j), tree: treeOf(d) };
    fs.rmSync(d, { recursive: true, force: true });
    return out;
  };
  // a split pack's tree may differ only by pax-named files written at their ustar names
  const agree = async (label, gz, r, { split = false, alt = {} } = {}) => {
    for (const chunk of split ? [0, 16384] : [0]) {
      const npm = await installs(gz, chunk);
      const how = `${label}${chunk ? ', fed in 16 KiB chunks' : ''}`;
      assert.deepEqual(npm.manifest, r.manifest, `M6 packManifest reads what npm installs: ${how}`);
      let want = r.files;
      if (split) want = r.files.map((f) => (alt[f.path] && npm.tree.some((t) => t.path === alt[f.path]) && !npm.tree.some((t) => t.path === f.path) ? { ...f, path: alt[f.path] } : f)).sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0));
      assert.deepEqual(npm.tree, want, `M6 npm's tar writes exactly packManifest's files: ${how}`);
    }
  };
  let n = 0;
  for (const [label, gz, r, o] of BUILT) {
    if (/^fixture /.test(label)) assert.equal(r.ok, true, `M6 ${label} is read`);
    if (r.ok) { n++; await agree(label, gz, r, o); }
  }
  assert.ok(n >= 11, `M6 the packs M1 to M5 read were checked (${n})`);
  // M5's second member: npm's tar installs the first member's manifest, fed whole or from the second member on
  const [, gz2, r2] = BUILT.find(([l]) => l === 'M5 a second member after padding');
  assert.equal(r2.refused, 'gzip', 'M6 the pack with a second member is refused');
  for (const chunk of [0, 64 * 1024]) assert.deepEqual((await installs(gz2, chunk)).manifest, fourOf(JSON.parse(MA)), `M6 npm installs the first member's manifest${chunk ? ', fed from the second member on' : ''}`);

  // the sweep: header bytes set to each value in turn
  const hidden = file(PJ, MB);
  const base = Buffer.concat([file(PJ, MA), paxEntry({ path: 'package/zz.txt' }), header({ name: 'package/R.md', size: hidden.length }), hidden, END]);
  const FIELDS = [[0, 100], [100, 108], [108, 116], [116, 124], [124, 136], [136, 148], [156, 157], [157, 257], [257, 263], [263, 265], [265, 297], [297, 329], [329, 337], [337, 345], [345, 500], [500, 512]];
  const at = [...new Set(FIELDS.flatMap(([a, b]) => [a, b - 1]).concat(475))];
  const swept = [];
  for (const st of [0, 1024, 2048]) for (const i of at) for (const v of [0x00, 0x20, 0x30, 0x37, 0x0a, 0x2f, 0xff]) {
    if (base[st + i] === v) continue;
    const t = Buffer.from(base);
    t[st + i] = v;
    sumFix(t.subarray(st, st + 512));
    swept.push([`header ${st / 512} byte ${i} set to ${v}`, zlib.gzipSync(t)]);
  }
  const sres = manifests(swept.map(([, b]) => b));
  let sread = 0;
  for (let i = 0; i < swept.length; i++) if (sres[i].ok) { sread++; await agree(`the sweep, ${swept[i][0]}`, swept[i][1], sres[i]); }
  assert.ok(sread > 0 && sread < swept.length, `M6 the sweep reads some packs and refuses others (${sread} of ${swept.length})`);

  // a pax name npm's tar may drop
  const split = [];
  for (const ch of ['\u00e9', '\u20ac', '\u{1f600}']) for (const lead of [0, 1, 2, 3]) for (const ustar of [PJ, 'package/other.txt', 'package/x.js']) {
    const p = `package/d/${'a'.repeat(240)}/${'b'.repeat(240)}/${'c'.repeat(lead)}${ch.repeat(Math.floor(200 / Buffer.byteLength(ch)))}`;
    const filler = file('package/x.js', Buffer.alloc(15360 - 1024 - 512, 120));
    split.push([`the split pack (${Buffer.byteLength(ch)}-byte, ${lead}, ${ustar.slice(8)})`, tgz(file(PJ, MA), filler, paxEntry({ path: p }), file(ustar, MB)), { split: true, alt: { [p.slice(8)]: ustar.slice(8) } }]);
  }
  const xres = manifests(split.map(([, b]) => b));
  let xread = 0;
  for (let i = 0; i < split.length; i++) {
    if (split[i][2].alt && Object.values(split[i][2].alt)[0] !== 'other.txt') assert.equal(xres[i].ok, false, `M6 ${split[i][0]} is refused`);
    if (xres[i].ok) { xread++; await agree(split[i][0], split[i][1], xres[i], split[i][2]); }
  }
  assert.equal(xread, 12, 'M6 every split pack to another file is read');
});

test('A3 no answer is unreachable in 15 s, and a body that never ends in 120 s, whatever the caller sets', async () => {
  const got = Object.fromEntries((await Promise.all(slow)).map((r) => [r.name, r]));
  for (const name of ['no-answer', 'drip']) assert.equal(got[name].code, 0, `A3 ${name}: the probe ran (${got[name].se.slice(0, 300)})`);
  const call = (name) => JSON.parse(got[name].so).res[0];
  const na = call('no-answer'), dr = call('drip');
  assert.ok(na.unreachable && na.ms >= 15000 && na.ms <= 25000, `A3 no-answer is unreachable in 15 s (${na.ms} ms, ${JSON.stringify(na).slice(0, 200)})`);
  assert.ok(dr.unreachable && dr.ms >= 120000 && dr.ms <= 127000, `A3 drip is unreachable in 120 s (${dr.ms} ms, ${JSON.stringify(dr).slice(0, 200)})`);
});
