// kit-install@2 (kit-1050): the GitHub source's contract. githubAsset (the release asset fetcher),
// packManifest (the pack's own package.json), the fake GitHub in test/lib/fake-registry.mjs and its
// signed bundles, and the shape of a real actions/attest-build-provenance bundle
// (test/fixtures/github-attestation/). The contract is the comment above packagePinPair in
// docs/devteam/scripts/devteam.mjs. Checks are numbered as in the ticket's spec.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { kit, testDir } from './lib/kit.mjs';
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
    for (const [name, to] of [['redirect-elsewhere', /^https:\/\/evil\.example\//], ['redirect-http', /^http:\/\/release-assets\.githubusercontent\.com\//], ['redirect-lookalike', /^https:\/\/githubusercontent\.com\.evil\.example\//], ['redirect-loopback', /^http:\/\/127\.0\.0\.1:\d+\//]]) {
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
