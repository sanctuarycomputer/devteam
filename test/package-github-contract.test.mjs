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
import { spawn, spawnSync } from 'node:child_process';
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
    const [k] = probe([{ asset: [PACK_URL, 'tarball'] }], ghEnv(reg)).res;
    assert.equal(k.refused, 'input', 'A5 a kind that is not pack or bundle is refused input');
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

test('A3 no answer is unreachable in 15 s, and a body that never ends in 120 s, whatever the caller sets', async () => {
  const got = Object.fromEntries((await Promise.all(slow)).map((r) => [r.name, r]));
  for (const name of ['no-answer', 'drip']) assert.equal(got[name].code, 0, `A3 ${name}: the probe ran (${got[name].se.slice(0, 300)})`);
  const call = (name) => JSON.parse(got[name].so).res[0];
  const na = call('no-answer'), dr = call('drip');
  assert.ok(na.unreachable && na.ms >= 15000 && na.ms <= 25000, `A3 no-answer is unreachable in 15 s (${na.ms} ms, ${JSON.stringify(na).slice(0, 200)})`);
  assert.ok(dr.unreachable && dr.ms >= 120000 && dr.ms <= 127000, `A3 drip is unreachable in 120 s (${dr.ms} ms, ${JSON.stringify(dr).slice(0, 200)})`);
});
