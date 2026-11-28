// kit-install@1's fake registry and fake npm (the contract is the comment above packagePinPair in
// docs/devteam/scripts/devteam.mjs). startFakeRegistry() serves test/fixtures/kit-install/registry/ on a
// loopback port as npm's registry does, and writes an `npm` that a test puts first on PATH. The fake npm
// answers --version, view, ci and audit signatures from that registry, and refuses a call that breaks
// the contract's calling rules, so a consumer's test sees the rule kept, not only the answer. Two kinds of
// refusal, told apart by their text:
//   `fake npm: … (kit-install@1)`  a contract rule (exactly one --registry= naming this registry, the
//                                  DEVTEAM_NPM_REGISTRY env() sets; --ignore-scripts; --prefix=<the folder
//                                  it runs in> and --workspaces=false, once each; each command's exact
//                                  arguments and nothing else; no npm_config_ variable, in any letter case
//                                  (npm reads the prefix so), but two different empty regular config
//                                  files; no .npmrc where it runs; view in a folder holding only its
//                                  package.json); real npm takes these. Like real
//                                  npm given --prefix and --workspaces=false, it reads nothing above that
//                                  folder: a workspace root or an .npmrc there changes nothing
//   `npm error code …`             what real npm does (10.x): a pair out of sync (package.json's version not
//                                  the lock entry's, an entry missing, an entry with dependencies), a tarball
//                                  whose sha512 isn't the lock's integrity, one file for both configs, a 404,
//                                  an attestation advertised but missing, a subject that isn't the package
// Like real npm, ci passes a root entry that differs, any lockfileVersion and an entry with no integrity,
// fetches attestations only when the manifest advertises them (pacote lib/registry.js), and passes audit
// signatures with registry signatures only when none are advertised. Unlike it, ci writes no
// node_modules/.package-lock.json.
//
//   const reg = await startFakeRegistry({ fail: 'integrity' });
//   spawnSync(process.execPath, [devteam, 'package', 'pin', 'v0.101.0'], { env: reg.env(process.env) });
//   // env() sets HOME to a folder of the fake's own, so nothing reaches the real ~/.devteam/hub/, and
//   // DEVTEAM_SIGSTORE_TEST_CA to the fake's own trust root (kit-974: the provenance is really signed)
//   reg.requests();       // every HTTP request: { method, url }
//   await reg.forge('forged');     // a forgery from now on (FORGERIES; null: none)
//   reg.calls();          // every npm call: { argv, cwd, npm_env, status }
//   await reg.fail('digest');   // another failure from now on (null: none)
//   await reg.close();
//
// Failures (FAILURES), one at a time:
//   unreachable     every connection to the registry's port is reset as it opens (ECONNRESET; a
//                   socket merely closed leaves node 18's fetch waiting forever)
//   integrity       the registry serves other bytes for every tarball, and a manifest that says so
//   no-attestation  manifests advertise no attestations and the bundle is a 404 (a package published
//                   without provenance: real npm's audit passes, so the kit must refuse it itself)
//   repo, workflow, ref, commit
//                   the provenance statement names another repository, workflow file, ref or commit
//   digest          the statement's subject digest is another package's
//   old-npm         npm says 9.4.2, and audit signatures checks no attestation
//   hostile-env     env() adds npm_config_*, NPM_CONFIG_* and mixed-case Npm_Config_* variables that point
//                   npm elsewhere, among them npm_config_@sanctuarycomputer:registry and
//                   Npm_Config_@sanctuarycomputer:registry (names no shell keeps, so the fake's npm is a
//                   node script, never a shell wrapper); a kit that drops only the two spellings
//                   npm_config_* and NPM_CONFIG_* leaves the mixed one, and the fake npm refuses it
//   server-error    every request is a 503 (an outage: unreachable to the kit, never a refusal)
//   attestation-gone
//                   manifests advertise attestations but the bundle is a 404 (real npm's audit fails E404)
//   redirect        the bundle is a 302 to the same bundle at another path the fake serves (/-/moved/…):
//                   a kit that follows it gets a 200 and passes every guard, so its test goes red
//
// The registry is the fixture's four packages (registry/devteam-<version>.tgz; each manifest is the
// tarball's package.json with dist and _id) and their provenance (registry/provenance.json, commits
// overridable with { commits: { <version>: <sha> } } for a test that makes its own upstream). Run as a
// script, `node fake-registry.mjs npm <state> …` is the npm and `serve <state>` the registry's process.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { fork, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
export const FIXTURES = path.resolve(path.dirname(SELF), '..', 'fixtures', 'kit-install');
export const NAME = '@sanctuarycomputer/devteam';
export const PUBLIC = 'https://registry.npmjs.org/';
export const FAILURES = ['unreachable', 'integrity', 'no-attestation', 'repo', 'workflow', 'ref', 'commit', 'digest', 'old-npm', 'hostile-env', 'server-error', 'attestation-gone', 'redirect'];
export const NPM_VERSION = '10.9.0';
export const OLD_NPM_VERSION = '9.4.2';
const SLSA = 'https://slsa.dev/provenance/v1';
const PUBLISH = 'https://github.com/npm/attestation/tree/main/specs/publish/v0.1';
const base = (name) => name.slice(name.indexOf('/') + 1);
const tarballPath = (name, version) => `${name}/-/${base(name)}-${version}.tgz`;
const j = (o) => `${JSON.stringify(o, null, 2)}\n`;

// ---- the registry's content -------------------------------------------------------------------
function packages(commits = {}) {
  const dir = path.join(FIXTURES, 'registry');
  const provenance = JSON.parse(fs.readFileSync(path.join(dir, 'provenance.json'), 'utf8'));
  const out = new Map();
  for (const f of fs.readdirSync(dir).sort()) {
    const m = /^devteam-(\d+\.\d+\.\d+)\.tgz$/.exec(f);
    if (!m) continue;
    const version = m[1];
    const tgz = fs.readFileSync(path.join(dir, f));
    // the same package in other bytes: what a registry serving something else hands out
    const other = zlib.gzipSync(zlib.gunzipSync(tgz), { level: 1 });
    out.set(version, { version, tgz, other, pkg: tarFile(zlib.gunzipSync(tgz), 'package/package.json'), provenance: { ...provenance[version], ...(commits[version] ? { commit: commits[version] } : {}) } });
  }
  return out;
}
const sha512 = (b) => crypto.createHash('sha512').update(b).digest();
// one file's JSON out of a ustar archive
function tarFile(tar, name) {
  for (let o = 0; o + 512 <= tar.length;) {
    const h = tar.subarray(o, o + 512);
    if (h.every((b) => b === 0)) break;
    const n = h.subarray(0, 100).toString('utf8').replace(/\0.*$/s, '');
    const size = parseInt(h.subarray(124, 136).toString('utf8').replace(/\0.*$/s, '').trim() || '0', 8);
    if (n === name) return JSON.parse(tar.subarray(o + 512, o + 512 + size).toString('utf8'));
    o += 512 + Math.ceil(size / 512) * 512;
  }
  throw new Error(`fake registry: no ${name} in a tarball`);
}
function manifest(p, fail) {
  const tgz = fail === 'integrity' ? p.other : p.tgz;
  return {
    ...p.pkg,
    dist: {
      tarball: `${PUBLIC}${tarballPath(NAME, p.version)}`,
      integrity: `sha512-${sha512(tgz).toString('base64')}`,
      shasum: crypto.createHash('sha1').update(tgz).digest('hex'),
      ...(fail === 'no-attestation' ? {} : { attestations: { url: `${PUBLIC}-/npm/v1/attestations/${NAME.replace('/', '%2f')}@${p.version}`, provenance: { predicateType: SLSA } } }),
    },
    _id: `${NAME}@${p.version}`,
  };
}
// The in-toto statement a release.yml run signs, as npm's attestations endpoint returns it (the shape
// of a real bundle: two attestations, each a sigstore bundle whose DSSE payload is the statement).
export function statement(p, fail) {
  const pv = p.provenance;
  const repo = fail === 'repo' ? 'someone-else/devteam' : pv.repo;
  const workflow = fail === 'workflow' ? '.github/workflows/other.yml' : pv.workflow;
  const ref = fail === 'ref' ? 'refs/heads/main' : pv.ref;
  const commit = fail === 'commit' ? crypto.createHash('sha1').update(`another commit ${p.version}`).digest('hex') : pv.commit;
  const digest = sha512(fail === 'digest' ? Buffer.from(`another package ${p.version}`) : p.tgz).toString('hex');
  return {
    _type: 'https://in-toto.io/Statement/v1',
    subject: [{ name: `pkg:npm/${NAME.replace('@', '%40')}@${p.version}`, digest: { sha512: digest } }],
    predicateType: SLSA,
    predicate: {
      buildDefinition: {
        buildType: 'https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1',
        externalParameters: { workflow: { ref, repository: `https://github.com/${repo}`, path: workflow } },
        internalParameters: { github: { event_name: 'push', repository_id: '1', repository_owner_id: '1' } },
        resolvedDependencies: [{ uri: `git+https://github.com/${repo}@${ref}`, digest: { gitCommit: commit } }],
      },
      runDetails: { builder: { id: 'https://github.com/actions/runner/github-hosted' }, metadata: { invocationId: `https://github.com/${repo}/actions/runs/1/attempts/1` } },
    },
  };
}
// npm's own publish attestation: signed with the registry's key, which the kit never reads
const envelope = (st) => ({
  mediaType: 'application/vnd.dev.sigstore.bundle+json;version=0.2',
  verificationMaterial: { tlogEntries: [], note: 'a fake: no signature here verifies' },
  dsseEnvelope: { payload: Buffer.from(JSON.stringify(st)).toString('base64'), payloadType: 'application/vnd.in-toto+json', signatures: [{ sig: 'ZmFrZQ==', keyid: '' }] },
});

// ---- the test CA (kit-974) ----------------------------------------------------------------------
// The SLSA provenance is signed as a release.yml run's is: a short-lived leaf certificate, issued by an
// intermediate under a root, signs the DSSE envelope, and a log signs an entry for it (Rekor's signed
// entry timestamp). Here the root, the intermediate and the log are the fake's own, made fresh for each
// registry: their trust root is written to <dir>/test-ca.json and env() names it in
// DEVTEAM_SIGSTORE_TEST_CA, which the kit takes only beside a loopback DEVTEAM_NPM_REGISTRY. Node makes no
// certificates, so they are built here in DER.
const der = {
  tlv(tag, ...parts) {
    const body = Buffer.concat(parts);
    const n = body.length;
    const len = n < 128 ? Buffer.from([n]) : n < 256 ? Buffer.from([0x81, n]) : Buffer.from([0x82, n >> 8, n & 255]);
    return Buffer.concat([Buffer.from([tag]), len, body]);
  },
  seq: (...p) => der.tlv(0x30, ...p),
  set: (...p) => der.tlv(0x31, ...p),
  int(b) { const x = Buffer.from(b); return der.tlv(0x02, x[0] & 0x80 ? Buffer.concat([Buffer.from([0]), x]) : x); },
  oid(s) {
    const [a, b, ...rest] = s.split('.').map(Number);
    const out = [40 * a + b];
    for (const v of rest) { const bytes = [v & 127]; for (let x = v >> 7; x; x >>= 7) bytes.unshift((x & 127) | 128); out.push(...bytes); }
    return der.tlv(0x06, Buffer.from(out));
  },
  utf8: (s) => der.tlv(0x0c, Buffer.from(s, 'utf8')),
  bits: (b) => der.tlv(0x03, Buffer.from([0]), b),
  octets: (b) => der.tlv(0x04, b),
  bool: (v) => der.tlv(0x01, Buffer.from([v ? 255 : 0])),
  time(ms) { const d = new Date(ms).toISOString(); return der.tlv(0x17, Buffer.from(`${d.slice(2, 4)}${d.slice(5, 7)}${d.slice(8, 10)}${d.slice(11, 13)}${d.slice(14, 16)}${d.slice(17, 19)}Z`)); },
  name: (cn) => (cn === null ? der.seq() : der.seq(der.set(der.seq(der.oid('2.5.4.10'), der.utf8('sigstore.dev'))), der.set(der.seq(der.oid('2.5.4.3'), der.utf8(cn))))),
};
const ECDSA_SHA256 = der.seq(der.oid('1.2.840.10045.4.3.2'));
// one certificate: subject cn (null: an empty name, as Fulcio's leaves have), its key, the issuer's name
// and key, validity [from, to] in ms, a CA or a leaf (a leaf carries the one URI in its SAN)
function mintCert({ cn, key, issuer, issuerKey, from, to, ca, uri = null }) {
  const ext = (oid, critical, value) => der.seq(der.oid(oid), ...(critical ? [der.bool(true)] : []), der.octets(value));
  const exts = [
    ext('2.5.29.15', true, ca ? der.tlv(0x03, Buffer.from([1, 0x06])) : der.tlv(0x03, Buffer.from([7, 0x80]))),
    ext('2.5.29.19', true, ca ? der.seq(der.bool(true)) : der.seq()),
    ...(uri ? [ext('2.5.29.17', true, der.seq(der.tlv(0x86, Buffer.from(uri))))] : []),
  ];
  // a positive serial whose first byte is 1 to 127: DER takes no leading zero byte, and OpenSSL refuses one
  const serial = crypto.randomBytes(16);
  serial[0] = (serial[0] & 0x7f) || 1;
  const tbs = der.seq(der.tlv(0xa0, der.int([2])), der.int(serial), ECDSA_SHA256, der.name(issuer), der.seq(der.time(from), der.time(to)), der.name(cn), crypto.createPublicKey(key).export({ type: 'spki', format: 'der' }), der.tlv(0xa3, der.seq(...exts)));
  return der.seq(tbs, ECDSA_SHA256, der.bits(crypto.sign('sha256', tbs, issuerKey)));
}
const pem = (k) => k.export({ type: 'pkcs8', format: 'pem' });
const newKey = () => crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey;
// a CA of the fake's own: { root, intermediate (DER), intKey, logKey (PEM) }
function makeCa(tag) {
  const rootKey = newKey(), intKey = newKey(), logKey = newKey();
  const from = Date.now() - 86400000, to = Date.now() + 10 * 365 * 86400000;
  const root = mintCert({ cn: `sigstore-test-${tag}`, key: rootKey, issuer: `sigstore-test-${tag}`, issuerKey: rootKey, from, to, ca: true });
  const intermediate = mintCert({ cn: `sigstore-test-${tag}-intermediate`, key: intKey, issuer: `sigstore-test-${tag}`, issuerKey: rootKey, from, to, ca: true });
  return { tag, root: root.toString('base64'), intermediate: intermediate.toString('base64'), intKey: pem(intKey), logKey: pem(logKey) };
}
// the trust root the kit reads from DEVTEAM_SIGSTORE_TEST_CA: the intermediate and the root, and the log's
// key (its id is the SHA-256 of its public key, as Rekor's is)
export function trustRoot(ca) {
  const spki = crypto.createPublicKey(ca.logKey).export({ type: 'spki', format: 'der' });
  return { v: 1, fulcio: [ca.intermediate, ca.root], rekor: { keyId: crypto.createHash('sha256').update(spki).digest('hex'), spki: spki.toString('base64'), name: LOG_NAME } };
}
// What a forger can serve (FORGERIES), one at a time, beside FAILURES (whose list kit-952 fixed):
//   no-slsa    the bundle holds npm's publish attestation only, no SLSA provenance
//   forged     the statement is changed after it was signed (one field of its predicate)
//   other-ca   the leaf is issued by another CA, not the one in the trust root
//   expired    the log's time is after the leaf's validity
//   bad-set    the log's signed entry timestamp signs another time
//   no-tlog    no entry from the trust root's log
//   san        the leaf names another workflow than the statement's (a certificate for other.yml)
//   san-repo   the leaf is another repository's release.yml at the tag (<repo>-fork, so a prefix compare fails too)
//   san-ref    the leaf is release.yml at refs/pull/1/merge (a pull_request run of upstream's own file)
//   san-ref-prefix  the leaf is release.yml at refs/tags/v<version>-x (a tag the version's is a prefix of)
//   impostor-ca  the leaf is issued by a CA with the trusted one's names but another key (only the
//              signature check on each certificate, not name matching, refuses it)
//   leaf-ca    the leaf is itself a CA
//   early      the log's time is before the leaf's validity starts
//   entry-payload, entry-sig, entry-cert
//              the log's entry, its timestamp signed by the trusted log, names another payload hash,
//              another signature or another certificate than the bundle's
export const FORGERIES = ['no-slsa', 'forged', 'other-ca', 'expired', 'bad-set', 'no-tlog', 'san', 'impostor-ca', 'leaf-ca', 'early', 'entry-payload', 'entry-sig', 'entry-cert', 'san-repo', 'san-ref', 'san-ref-prefix'];
const PAE = (type, body) => Buffer.concat([Buffer.from(`DSSEv1 ${Buffer.byteLength(type)} ${type} ${body.length} `), body]);
// gh (kit-install@2): the tlog entry as Rekor v1 writes it for a GitHub attestation: a global logIndex,
// the signed entry timestamp over it, and an inclusion proof at the shard-local index with a checkpoint
function signedEnvelope(st, ca, other, forge, impostor, gh = null) {
  const now = Date.now();
  const leafKey = newKey();
  const w = st.predicate.buildDefinition.externalParameters.workflow;
  const by = forge === 'other-ca' ? other : forge === 'impostor-ca' ? impostor : ca;
  const from = forge === 'expired' ? now - 3600000 : forge === 'early' ? now + 120000 : now - 1000;
  const leafRepo = forge === 'san-repo' ? `${w.repository}-fork` : w.repository;
  const leafRef = forge === 'san-ref' ? 'refs/pull/1/merge' : forge === 'san-ref-prefix' ? `${w.ref}-x` : w.ref;
  const uri = `${leafRepo}/${forge === 'san' ? '.github/workflows/other.yml' : w.path}@${leafRef}`;
  const leaf = mintCert({ cn: null, key: leafKey, issuer: `sigstore-test-${by.tag}-intermediate`, issuerKey: crypto.createPrivateKey(by.intKey), from, to: from + 600000, ca: forge === 'leaf-ca', uri });
  const type = 'application/vnd.in-toto+json';
  const body = Buffer.from(JSON.stringify(st));
  const sig = crypto.sign('sha256', PAE(type, body), leafKey).toString('base64');
  const signedBody = forge === 'forged' ? Buffer.from(JSON.stringify({ ...st, predicate: { ...st.predicate, runDetails: { ...st.predicate.runDetails, builder: { id: 'https://example.com/a-forger' } } } })) : body;
  const pemOf = (c) => `-----BEGIN CERTIFICATE-----\n${c.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----\n`;
  // what the log's entry names: this payload, signature and leaf, unless an entry-* forgery swaps one
  const entryHash = crypto.createHash('sha256').update(forge === 'entry-payload' ? Buffer.from('another payload') : body).digest('hex');
  const entrySig = forge === 'entry-sig' ? crypto.sign('sha256', Buffer.from('another statement'), leafKey).toString('base64') : sig;
  const entryCert = forge === 'entry-cert' ? mintCert({ cn: null, key: newKey(), issuer: `sigstore-test-${ca.tag}-intermediate`, issuerKey: crypto.createPrivateKey(ca.intKey), from, to: from + 600000, ca: false, uri }) : leaf;
  const entry = { apiVersion: '0.0.1', kind: 'dsse', spec: { envelopeHash: { algorithm: 'sha256', value: '0'.repeat(64) }, payloadHash: { algorithm: 'sha256', value: entryHash }, signatures: [{ signature: entrySig, verifier: Buffer.from(pemOf(entryCert)).toString('base64') }] } };
  const canonicalizedBody = Buffer.from(JSON.stringify(entry)).toString('base64');
  const integratedTime = Math.floor(now / 1000);
  const { keyId } = trustRoot(ca).rekor;
  const logIndex = gh ? GLOBAL_BASE + SHARD_INDEX : 1;
  const set = JSON.stringify({ body: canonicalizedBody, integratedTime: forge === 'bad-set' ? integratedTime - 1 : integratedTime, logID: keyId, logIndex });
  const tlog = { logIndex: String(logIndex), logId: { keyId: Buffer.from(keyId, 'hex').toString('base64') }, kindVersion: { kind: 'dsse', version: '0.0.1' }, integratedTime: String(integratedTime), inclusionPromise: { signedEntryTimestamp: crypto.sign('sha256', Buffer.from(set), crypto.createPrivateKey(ca.logKey)).toString('base64') }, ...(gh && gh.fail !== 'no-inclusion-proof' ? { inclusionProof: inclusionProof(canonicalizedBody, ca, gh) } : {}), canonicalizedBody };
  return {
    mediaType: 'application/vnd.dev.sigstore.bundle.v0.3+json',
    verificationMaterial: { certificate: { rawBytes: leaf.toString('base64') }, tlogEntries: forge === 'no-tlog' ? [] : [tlog], timestampVerificationData: { rfc3161Timestamps: [] } },
    dsseEnvelope: { payload: signedBody.toString('base64'), payloadType: type, signatures: [{ sig, keyid: '' }] },
  };
}
function attestations(p, fail, state) {
  const st = statement(p, fail);
  const pub = { _type: 'https://in-toto.io/Statement/v0.1', subject: st.subject, predicateType: PUBLISH, predicate: { name: NAME, version: p.version, registry: 'https://registry.npmjs.org' } };
  return { attestations: [{ predicateType: PUBLISH, bundle: envelope(pub) }, { predicateType: SLSA, bundle: signedEnvelope(st, state.ca, state.otherCa, state.forge, state.impostorCa) }].filter((a) => !(state.forge === 'no-slsa' && a.predicateType === SLSA)) };
}

// ---- the fake GitHub (kit-install@2) ------------------------------------------------------------
// A release v<version> of the provenance's repository has two assets, as release.yml attaches them:
// <pack>, npm pack's file name (the registry's tarball, the same bytes), and <pack>.sigstore.json, the
// bundle actions/attest-build-provenance makes for it. Downloads go through a redirect to a stand-in for
// release-assets.githubusercontent.com, as GitHub's do; githubAsset, given DEVTEAM_GITHUB_DOWNLOAD, sends
// https://github.com/<p> to <url><p> and https://<h>.githubusercontent.com/<p> to
// <url>-/githubusercontent/<h>.githubusercontent.com/<p>.
//
// GitHub's failures (GITHUB_FAILURES), one at a time, beside FAILURES (whose unreachable and server-error
// stop these routes too):
//   no-asset, no-bundle  the pack, or the bundle, is a 404
//   digest               the statement's subject digest is another file's sha256
//   repo, workflow, ref, commit
//                        the statement names another repository, workflow file, ref (so does the leaf's
//                        SAN, which follows the statement) or commit
//   inclusion-proof      one hash of the inclusion proof is flipped: it no longer leads to its root
//   checkpoint-key       the checkpoint is signed by another key, under the log's name and key hint
//   checkpoint-root      the checkpoint, signed by the log, carries another root hash
//   checkpoint-size      the checkpoint, signed by the log, carries another tree size (the proof's + 1)
//   checkpoint-origin    the checkpoint, signed by the log's key, names another log (rekor.other.test)
//   no-inclusion-proof   the tlog entry has no inclusion proof (Rekor v2's shape, which the design refuses)
//   two-subjects         the statement has two subjects, the pack's and another file's
//   replaced             another pack (the same package in other bytes) with a bundle rightly made for
//                        those bytes: a replaced pair (W1), which only a pin's integrity refuses
//   rate-limited         every GitHub request is a 429
//   forbidden            the stand-in answers 403 (as for an expired signed URL)
//   no-answer            the asset's request is held open and never answered
//   drip                 the asset answers 200 at once, then one byte a second, never ending
//   hops-5, hops-6       5 or 6 redirects (through hop<k>.githubusercontent.com) before the asset
//   redirect-elsewhere   the redirect goes to https://evil.example/…
//   redirect-http        it goes to http://release-assets.githubusercontent.com/…
//   redirect-lookalike   it goes to https://githubusercontent.com.evil.example/…
//   redirect-loopback    it goes to the fake's own http://127.0.0.1:<port>/…
//   redirect-suffix      it goes to https://evilgithubusercontent.com/…
//   big-pack             the pack is 64 MiB and one byte, chunked, with no content-length
//   big-bundle           the bundle declares a content-length of 1 MiB and one byte
//   bundle-at-cap        the bundle is exactly 1 MiB (its JSON padded with spaces)
//   pack-at-cap          the pack is exactly 64 MiB, with its content-length
//   short-body           the pack declares its length, sends half of it, and closes the connection
// FORGERIES apply to the bundle as to npm's; no-slsa serves npm's publish attestation as the asset, so
// its predicateType isn't SLSA's.
export const GITHUB_FAILURES = ['no-asset', 'no-bundle', 'digest', 'repo', 'workflow', 'ref', 'commit', 'inclusion-proof', 'checkpoint-key', 'checkpoint-root', 'checkpoint-size', 'checkpoint-origin', 'no-inclusion-proof', 'two-subjects', 'replaced', 'rate-limited', 'forbidden', 'no-answer', 'drip', 'hops-5', 'hops-6', 'redirect-elsewhere', 'redirect-http', 'redirect-lookalike', 'redirect-loopback', 'redirect-suffix', 'big-pack', 'big-bundle', 'bundle-at-cap', 'pack-at-cap', 'short-body'];
// the log's name in its checkpoints (the trust root's rekor.name), its tree, and where the entry sits:
// Rekor v1's inclusion proof indexes the entry in its shard (SHARD_INDEX, in a tree of TREE_SIZE leaves,
// so the proof has inner and border hashes), while logIndex and the signed entry timestamp use the global
// index, GLOBAL_BASE + SHARD_INDEX
export const LOG_NAME = 'rekor.devteam.test';
// the repository whose releases the fake serves: the kit's upstream, as the fixture's provenance names it
// (0.99.0's statement names another, as on the registry: its provenance is the fixture's bad one)
export const GITHUB_REPO = 'sanctuarycomputer/devteam';
const TREE_ID = '1';
const TREE_SIZE = 11, SHARD_INDEX = 9, GLOBAL_BASE = 1000000;
export const MIB = 1024 * 1024;
// npm pack's file name for a package: the name without its @, its / as -, then -<version>.tgz
export const packName = (name, version) => `${name.replace(/^@/, '').replace('/', '-')}-${version}.tgz`;
// the asset's URL on github.com, as packagePinPair's GitHub form has it
export const releaseUrl = (repo, version, file) => `https://github.com/${repo}/releases/download/v${version}/${file}`;
const H = (...p) => crypto.createHash('sha256').update(Buffer.concat(p)).digest();
const leafHash = (b) => H(Buffer.from([0]), b);
const nodeHash = (l, r) => H(Buffer.from([1]), l, r);
const split = (n) => { let k = 1; while (k * 2 < n) k *= 2; return k; };
// RFC 6962 §2.1: the tree hash of leaves, and the audit path of leaf m (from the leaf up)
const mth = (ls) => (ls.length === 1 ? leafHash(ls[0]) : nodeHash(mth(ls.slice(0, split(ls.length))), mth(ls.slice(split(ls.length)))));
function auditPath(m, ls) {
  if (ls.length === 1) return [];
  const k = split(ls.length);
  return m < k ? [...auditPath(m, ls.slice(0, k)), mth(ls.slice(k))] : [...auditPath(m - k, ls.slice(k)), mth(ls.slice(0, k))];
}
// the entry's inclusion proof and checkpoint; gh.fail breaks one part
function inclusionProof(body, ca, gh) {
  const leaves = Array.from({ length: TREE_SIZE }, (_, i) => (i === SHARD_INDEX ? Buffer.from(body, 'base64') : Buffer.from(`another entry ${i}`)));
  const root = mth(leaves);
  const hashes = auditPath(SHARD_INDEX, leaves);
  if (gh.fail === 'inclusion-proof') hashes[0] = Buffer.from(hashes[0].map((b, i) => (i === 0 ? b ^ 1 : b)));
  const noteRoot = gh.fail === 'checkpoint-root' ? H(Buffer.from('another root')) : root;
  const origin = gh.fail === 'checkpoint-origin' ? 'rekor.other.test' : LOG_NAME;
  const note = `${origin} - ${TREE_ID}\n${gh.fail === 'checkpoint-size' ? TREE_SIZE + 1 : TREE_SIZE}\n${noteRoot.toString('base64')}\n`;
  const key = gh.fail === 'checkpoint-key' ? newKey() : crypto.createPrivateKey(ca.logKey);
  const hint = Buffer.from(trustRoot(ca).rekor.keyId, 'hex').subarray(0, 4);
  const sig = Buffer.concat([hint, crypto.sign('sha256', Buffer.from(note), key)]).toString('base64');
  return { logIndex: String(SHARD_INDEX), rootHash: root.toString('base64'), treeSize: String(TREE_SIZE), hashes: hashes.map((h) => h.toString('base64')), checkpoint: { envelope: `${note}\n— ${LOG_NAME} ${sig}\n` } };
}
// the statement actions/attest-build-provenance signs for one file, in the shape of the recorded real one
// (test/fixtures/github-attestation/): one subject, the file's name and sha256
export function githubStatement(p, gfail) {
  const pv = p.provenance;
  const repo = gfail === 'repo' ? 'someone-else/devteam' : pv.repo;
  const workflow = gfail === 'workflow' ? '.github/workflows/other.yml' : pv.workflow;
  const ref = gfail === 'ref' ? 'refs/heads/main' : pv.ref;
  const commit = gfail === 'commit' ? crypto.createHash('sha1').update(`another commit ${p.version}`).digest('hex') : pv.commit;
  const bytes = gfail === 'replaced' ? p.other : p.tgz;
  const sha256 = crypto.createHash('sha256').update(gfail === 'digest' ? Buffer.from(`another file ${p.version}`) : bytes).digest('hex');
  return {
    _type: 'https://in-toto.io/Statement/v1',
    subject: [{ name: packName(NAME, p.version), digest: { sha256 } }, ...(gfail === 'two-subjects' ? [{ name: 'another.tgz', digest: { sha256: crypto.createHash('sha256').update(`another file ${p.version}`).digest('hex') } }] : [])],
    predicateType: SLSA,
    predicate: {
      buildDefinition: {
        buildType: 'https://actions.github.io/buildtypes/workflow/v1',
        externalParameters: { workflow: { ref, repository: `https://github.com/${repo}`, path: workflow } },
        internalParameters: { github: { event_name: 'release', repository_id: '1', repository_owner_id: '1', runner_environment: 'github-hosted' } },
        resolvedDependencies: [{ uri: `git+https://github.com/${repo}@${ref}`, digest: { gitCommit: commit } }],
      },
      runDetails: { builder: { id: `https://github.com/${repo}/${workflow}@${ref}` }, metadata: { invocationId: `https://github.com/${repo}/actions/runs/1/attempts/1` } },
    },
  };
}
function githubBundle(p, state) {
  const st = githubStatement(p, state.githubFail);
  if (state.forge === 'no-slsa') return envelope({ _type: 'https://in-toto.io/Statement/v0.1', subject: st.subject, predicateType: PUBLISH, predicate: { name: NAME, version: p.version, registry: 'https://registry.npmjs.org' } });
  return signedEnvelope(st, state.ca, state.otherCa, state.forge, state.impostorCa, { fail: state.githubFail });
}

// GitHub's routes; true when the request was one of them (answered, or held open)
function github(req, res, p, state, pkgs) {
  const gf = state.githubFail;
  const repo = GITHUB_REPO;
  const STAND = '/-/githubusercontent/';
  const dl = p.startsWith(`/${repo}/releases/download/`) ? /^\/[^/]+\/[^/]+\/releases\/download\/v(\d+\.\d+\.\d+)\/([^/]+)$/.exec(p) : null;
  const stand = p.startsWith(STAND) ? /^\/-\/githubusercontent\/([a-z0-9.-]+\.githubusercontent\.com)\/(?:hop\/(\d+)\/)?github-production-release-asset\/(\d+\.\d+\.\d+)\/([^/]+)$/.exec(p) : null;
  if (!dl && !stand && !p.startsWith(STAND)) return false;
  const send = (status, headers, body) => { res.writeHead(status, headers); res.end(body); };
  if (gf === 'rate-limited') { send(429, { 'content-type': 'application/json' }, '{"message":"rate limited"}\n'); return true; }
  if (!dl && !stand) { send(404, { 'content-type': 'text/plain' }, 'Not Found'); return true; }
  const [version, file] = dl ? [dl[1], dl[2]] : [stand[3], stand[4]];
  const pk = pkgs.get(version);
  const pack = packName(NAME, version);
  const kind = file === pack ? 'pack' : file === `${pack}.sigstore.json` ? 'bundle' : null;
  if (!pk || !kind) { send(404, { 'content-type': 'text/plain' }, 'Not Found'); return true; }
  const host = req.headers.host;
  const asset = (h, hop) => `https://${h}/${hop ? `hop/${hop}/` : ''}github-production-release-asset/${version}/${file}?sig=x`;
  if (dl) {
    if ((gf === 'no-asset' && kind === 'pack') || (gf === 'no-bundle' && kind === 'bundle')) { send(404, { 'content-type': 'text/plain' }, 'Not Found'); return true; }
    const to = { 'redirect-elsewhere': `https://evil.example/${version}/${file}`, 'redirect-http': asset('release-assets.githubusercontent.com').replace('https:', 'http:'), 'redirect-lookalike': `https://githubusercontent.com.evil.example/${version}/${file}`, 'redirect-suffix': `https://evilgithubusercontent.com/${version}/${file}`, 'redirect-loopback': `http://${host}${STAND}release-assets.githubusercontent.com/github-production-release-asset/${version}/${file}` }[gf]
      ?? (gf === 'hops-5' || gf === 'hops-6' ? asset('hop1.githubusercontent.com', 1) : asset('release-assets.githubusercontent.com'));
    send(302, { location: to }, '');
    return true;
  }
  // a hop: on to the next, until the count is reached (the github.com redirect was the first)
  const hop = Number(stand[2] ?? 0);
  const hops = gf === 'hops-5' ? 5 : gf === 'hops-6' ? 6 : 1;
  if (hop && hop + 1 < hops) { send(302, { location: asset(`hop${hop + 1}.githubusercontent.com`, hop + 1) }, ''); return true; }
  if (hop) { send(302, { location: asset('release-assets.githubusercontent.com') }, ''); return true; }
  if (stand[1] !== 'release-assets.githubusercontent.com') { send(404, { 'content-type': 'text/plain' }, 'Not Found'); return true; }
  if (gf === 'forbidden') { send(403, { 'content-type': 'application/xml' }, '<Error><Code>AuthenticationFailed</Code></Error>'); return true; }
  if (gf === 'no-answer') return true;
  if (gf === 'drip') {
    res.writeHead(200, { 'content-type': 'application/octet-stream' });
    const t = setInterval(() => res.write(Buffer.from([0])), 1000);
    res.on('close', () => clearInterval(t));
    return true;
  }
  // a long body of zeros, written as the reader takes it
  const zeros = (n, headers) => {
    res.writeHead(200, { 'content-type': 'application/octet-stream', ...headers });
    const chunk = Buffer.alloc(64 * 1024);
    let left = n;
    const more = () => { while (left > 0) { const c = chunk.subarray(0, Math.min(chunk.length, left)); left -= c.length; if (!res.write(c)) return res.once('drain', more); } res.end(); };
    res.on('close', () => { left = 0; });
    more();
  };
  if (kind === 'pack') {
    if (gf === 'big-pack') { zeros(64 * MIB + 1, {}); return true; }
    if (gf === 'pack-at-cap') { zeros(64 * MIB, { 'content-length': 64 * MIB }); return true; }
    if (gf === 'short-body') {
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': pk.tgz.length });
      res.write(pk.tgz.subarray(0, pk.tgz.length >> 1), () => res.destroy());
      return true;
    }
    send(200, { 'content-type': 'application/octet-stream', 'content-length': (gf === 'replaced' ? pk.other : pk.tgz).length }, gf === 'replaced' ? pk.other : pk.tgz);
    return true;
  }
  if (gf === 'big-bundle') { zeros(MIB + 1, { 'content-length': MIB + 1 }); return true; }
  let body = Buffer.from(JSON.stringify(githubBundle(pk, state)));
  if (gf === 'bundle-at-cap') body = Buffer.concat([body, Buffer.alloc(MIB - body.length, ' ')]);
  send(200, { 'content-type': 'application/json', 'content-length': body.length }, body);
  return true;
}

// ---- the server -------------------------------------------------------------------------------
// The registry runs in a process of its own, so a test that blocks on spawnSync (running the kit, or npm)
// is still answered. The parent writes the state file and tells the child to read it again.
function serve(stateFile) {
  let state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  const pkgs = packages(state.commits);
  const server = http.createServer((req, res) => {
    // every request, in order, for a test that counts what the kit asked (kit-974: the bundle once)
    fs.appendFileSync(state.requests, `${JSON.stringify({ method: req.method, url: req.url, authorization: req.headers.authorization ?? null, 'user-agent': req.headers['user-agent'] ?? null })}\n`);
    const send = (status, type, body) => { res.writeHead(status, { 'content-type': type }); res.end(body); };
    const notFound = () => send(404, 'application/json', '{"error":"Not found"}\n');
    if (req.method !== 'GET') return notFound();
    if (state.fail === 'server-error') return send(503, 'application/json', '{"error":"Service Unavailable"}\n');
    let p;
    try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { return notFound(); }
    if (github(req, res, p, state, pkgs)) return;
    // where the redirect failure points: the same answer, served live
    const moved = p.startsWith('/-/moved/');
    if (moved) p = p.slice('/-/moved'.length);
    const at = /^\/-\/npm\/v1\/attestations\/(.+)@(\d+\.\d+\.\d+)$/.exec(p);
    if (at) {
      const pk = at[1] === NAME && pkgs.get(at[2]);
      if (!pk || state.fail === 'no-attestation' || state.fail === 'attestation-gone') return notFound();
      if (state.fail === 'redirect' && !moved) { res.writeHead(302, { location: `http://${req.headers.host}/-/moved${req.url}` }); return res.end(); }
      return send(200, 'application/json', JSON.stringify(attestations(pk, state.fail, state)));
    }
    if (p === `/${NAME}`) {
      const versions = Object.fromEntries([...pkgs.values()].map((pk) => [pk.version, manifest(pk, state.fail)]));
      return send(200, 'application/json', JSON.stringify({ name: NAME, 'dist-tags': { latest: [...pkgs.keys()].at(-1) }, versions }));
    }
    const one = p.startsWith(`/${NAME}/`) && /^\d+\.\d+\.\d+$/.test(p.slice(NAME.length + 2)) && pkgs.get(p.slice(NAME.length + 2));
    if (one) return send(200, 'application/json', JSON.stringify(manifest(one, state.fail)));
    const tb = new RegExp(`^/${NAME}/-/${base(NAME)}-(\\d+\\.\\d+\\.\\d+)\\.tgz$`).exec(p);
    const pk = tb && pkgs.get(tb[1]);
    if (pk) return send(200, 'application/octet-stream', state.fail === 'integrity' ? pk.other : pk.tgz);
    return notFound();
  });
  server.keepAliveTimeout = 500;
  const sockets = new Set();
  // unreachable: the port stays ours (no other process can take it between failures), and every
  // connection is reset as it opens, so nothing is ever answered
  server.on('connection', (s) => {
    if (state.fail === 'unreachable') return s.resetAndDestroy();
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
  });
  process.on('message', (m) => {
    try {
      state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      if (state.fail === 'unreachable') for (const s of sockets) s.resetAndDestroy();
      process.send({ ok: true, id: m.id });
    } catch (e) { process.send({ ok: false, id: m.id, error: String(e?.message ?? e) }); }
  });
  process.on('disconnect', () => process.exit(0));
  server.once('error', (e) => { process.send({ ready: false, error: String(e?.message ?? e) }); process.exit(1); });
  server.listen(0, '127.0.0.1', () => process.send({ ready: true, port: server.address().port }));
}

export async function startFakeRegistry({ fail = null, commits = {}, forge = null, githubFail = null } = {}) {
  if (fail !== null && !FAILURES.includes(fail)) throw new Error(`fake registry: no failure called ${fail}`);
  if (forge !== null && !FORGERIES.includes(forge)) throw new Error(`fake registry: no forgery called ${forge}`);
  if (githubFail !== null && !GITHUB_FAILURES.includes(githubFail)) throw new Error(`fake registry: no GitHub failure called ${githubFail}`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-fake-registry-'));
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  const stateFile = path.join(dir, 'state.json');
  const callsFile = path.join(dir, 'calls.jsonl');
  // a HOME of the fake's own: a test's installs, hub tree included, never reach the real one
  const home = path.join(dir, 'home');
  fs.mkdirSync(home);
  // the test CA, and another CA the trust root doesn't name (forgery 'other-ca')
  // and an impostor: CA a's names, its own keys (forgery 'impostor-ca')
  const ca = makeCa('a'), otherCa = makeCa('b'), impostorCa = makeCa('a');
  const caFile = path.join(dir, 'test-ca.json');
  fs.writeFileSync(caFile, JSON.stringify(trustRoot(ca)));
  const requestsFile = path.join(dir, 'requests.jsonl');
  const state = { url: null, fail, commits, calls: callsFile, scratch: dir, forge, githubFail, ca, otherCa, impostorCa, requests: requestsFile };
  const save = () => fs.writeFileSync(stateFile, JSON.stringify(state));
  save();
  const child = fork(SELF, ['serve', stateFile], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
  let first;
  try {
    first = await new Promise((resolve, reject) => {
      child.once('message', resolve);
      child.once('exit', (code) => reject(new Error(`fake registry: the server exited (${code}) before it was ready`)));
    });
    if (!first.ready) throw new Error(`fake registry: ${first.error}`);
  } catch (e) {
    child.kill();
    fs.rmSync(dir, { recursive: true, force: true });
    throw e;
  }
  child.removeAllListeners('exit');
  state.url = `http://127.0.0.1:${first.port}/`;
  save();
  let ids = 0;
  let closing = null;
  const tell = () => new Promise((resolve, reject) => {
    const id = ++ids;
    const on = (m) => { if (m.id !== id) return; child.off('message', on); if (m.ok) resolve(); else reject(new Error(`fake registry: ${m.error}`)); };
    child.on('message', on);
    child.send({ id });
  });
  // the npm is a node script, not a shell wrapper: a shell (dash) drops variables whose names aren't shell
  // names, such as npm_config_@scope:registry, which real npm reads, so the fake must see them too
  if (/\s/.test(process.execPath)) throw new Error(`fake registry: node's path has a space, which a #! line can't hold (${process.execPath})`);
  fs.writeFileSync(path.join(bin, 'npm'), `#!${process.execPath}\nprocess.exitCode = 1;\nimport(${JSON.stringify(pathToFileURL(SELF).href)}).then((m) => m.fakeNpm(${JSON.stringify(stateFile)}, process.argv.slice(2)));\n`, { mode: 0o755 });
  return {
    url: state.url, port: first.port, bin, dir, home,
    // base's variables with this npm first on PATH and the registry named for the kit (a loopback URL,
    // the only kind DEVTEAM_NPM_REGISTRY may name); hostile-env adds npm config that points elsewhere
    env(baseEnv = process.env) {
      const e = { ...baseEnv, PATH: `${bin}${path.delimiter}${baseEnv.PATH ?? ''}`, DEVTEAM_NPM_REGISTRY: state.url, DEVTEAM_GITHUB_DOWNLOAD: state.url, DEVTEAM_SIGSTORE_TEST_CA: caFile, HOME: home };
      if (state.fail === 'hostile-env') {
        const evil = path.join(dir, 'evil-npmrc');
        fs.writeFileSync(evil, 'registry=http://127.0.0.1:9/\nignore-scripts=false\n');
        Object.assign(e, { npm_config_registry: 'http://127.0.0.1:9/', NPM_CONFIG_USERCONFIG: evil, npm_config_ignore_scripts: 'false', 'npm_config_@sanctuarycomputer:registry': 'http://127.0.0.1:9/', 'Npm_Config_@sanctuarycomputer:registry': 'http://127.0.0.1:9/' });
      }
      return e;
    },
    // the test CA's trust root (test-ca.json), as env() names it in DEVTEAM_SIGSTORE_TEST_CA
    caFile,
    // another GitHub failure from now on (null: none); resolves once the registry has it
    async githubFail(name) {
      if (name !== null && !GITHUB_FAILURES.includes(name)) throw new Error(`fake registry: no GitHub failure called ${name}`);
      state.githubFail = name;
      save();
      await tell();
    },
    // another forgery from now on (null: none); resolves once the registry has it
    async forge(name) {
      if (name !== null && !FORGERIES.includes(name)) throw new Error(`fake registry: no forgery called ${name}`);
      state.forge = name;
      save();
      await tell();
    },
    // every HTTP request the registry was sent: { method, url }
    requests() {
      if (!fs.existsSync(requestsFile)) return [];
      return fs.readFileSync(requestsFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    },
    // another failure from now on (null: none); resolves once the registry has it
    async fail(name) {
      if (name !== null && !FAILURES.includes(name)) throw new Error(`fake registry: no failure called ${name}`);
      state.fail = name;
      save();
      await tell();
    },
    calls() {
      if (!fs.existsSync(callsFile)) return [];
      return fs.readFileSync(callsFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    },
    // stops the registry and removes its folder; every call, overlapping or later, gets the same promise
    close() {
      closing ??= (async () => {
        if (child.exitCode === null && child.signalCode === null) {
          const gone = new Promise((resolve) => child.once('exit', resolve));
          if (child.connected) child.disconnect(); else child.kill();
          await gone;
        }
        fs.rmSync(dir, { recursive: true, force: true });
      })();
      return closing;
    },
  };
}

// ---- the fake npm -----------------------------------------------------------------------------
export async function fakeNpm(stateFile, args) {
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  const npmEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => /^npm_config_/i.test(k)));
  let status = 0;
  const say = (s) => process.stdout.write(`${s}\n`);
  const err = (code, s) => { process.stderr.write(`npm error code ${code}\nnpm error ${s}\n`); return 1; };
  const rule = (s) => { process.stderr.write(`fake npm: ${s} (kit-install@1)\n`); return 1; };
  const run = async () => {
    if (args[0] === '--version' || args[0] === '-v') { say(state.fail === 'old-npm' ? OLD_NPM_VERSION : NPM_VERSION); return 0; }
    // the calling rules: one registry by flag, no scripts, no config but two empty files
    const reg = args.filter((a) => a.startsWith('--registry=')).map((a) => a.slice(11));
    if (reg.length !== 1 || reg[0] !== state.url) return rule(`every call passes exactly one --registry=, the registry DEVTEAM_NPM_REGISTRY names (got ${reg.length ? reg.join(' ') : 'none'})`);
    if (!args.includes('--ignore-scripts')) return rule('every call passes --ignore-scripts');
    // npm's prefix is the folder it runs in, so it never walks up to a package.json, its workspaces, its
    // lock or an .npmrc above it (real npm 10.7 and 10.9: with these it reads none of them)
    const prefixes = args.filter((a) => a.startsWith('--prefix='));
    const here = (q) => { try { return fs.realpathSync(q) === fs.realpathSync('.'); } catch { return false; } };
    const ws = args.filter((a) => a.startsWith('--workspaces='));
    if (prefixes.length !== 1 || !here(prefixes[0].slice(9)) || ws.length !== 1 || ws[0] !== '--workspaces=false') {
      return rule(`every call passes --prefix=<the folder it runs in> and --workspaces=false, once each (got ${[...prefixes, ...ws].join(' ') || 'neither'})`);
    }
    // each command's exact arguments: the flags once, its own, and nothing that undoes them
    const known = { view: ['--json'], ci: ['--dry-run'], audit: [] };
    const plain = args.filter((a) => !a.startsWith('-'));
    if (known[plain[0]]) {
      const extra = args.filter((a) => a.startsWith('-') && !a.startsWith('--registry=') && a !== '--ignore-scripts' && a !== prefixes[0] && a !== '--workspaces=false' && !known[plain[0]].includes(a));
      const once = args.filter((a) => a === '--ignore-scripts').length === 1 && known[plain[0]].every((f) => args.filter((a) => a === f).length <= 1);
      const shape = plain[0] === 'view' ? plain.length >= 2 && plain.length <= 3 && (plain.length === 2 || /^[A-Za-z_][\w.]*$/.test(plain[2]))
        : plain[0] === 'ci' ? plain.length === 1 : plain.length === 2 && plain[1] === 'signatures';
      if (extra.length || !once || !shape) return rule(`every call is exactly view <name>@<version> [<field>] [--json], ci [--dry-run] or audit signatures, with --registry=<the registry>, --ignore-scripts, --prefix=<the folder it runs in> and --workspaces=false and nothing else (got ${args.join(' ')})`);
    }
    if (fs.existsSync('.npmrc')) return rule('npm runs in a folder with no .npmrc');
    const viewOk = () => { try { return fs.readdirSync('.').join('/') === 'package.json' && fs.lstatSync('package.json').isFile() && fs.readFileSync('package.json', 'utf8').trim() === '{}'; } catch { return false; } };
    if (plain[0] === 'view' && !viewOk()) return rule('view runs in its own folder holding only a package.json the step writes ({}, a regular file)');
    const stray = Object.keys(npmEnv).filter((k) => !['npm_config_userconfig', 'npm_config_globalconfig'].includes(k));
    if (stray.length) return rule(`npm config from the environment reached npm: ${stray.sort().join(', ')}`);
    const u = npmEnv.npm_config_userconfig, g = npmEnv.npm_config_globalconfig;
    if (!u || !g) return rule('npm_config_userconfig and npm_config_globalconfig both name an empty file');
    if (path.resolve(u) === path.resolve(g)) return err('ECONFIG', `double-loading config "${g}" as "global", previously loaded as "user"`);
    for (const f of [u, g]) { let st; try { st = fs.statSync(f); } catch { st = null; } if (!st?.isFile() || st.size !== 0) return rule(`${f} is an empty file (a regular one)`); }
    const words = args.filter((a) => !a.startsWith('-'));
    // an answer that isn't 200: a 5xx or a 429 is npm's E<status> (an outage), anything else its E404
    const notOk = (r, what) => (r.status >= 500 || r.status === 429
      ? err(`E${r.status}`, `${r.status} ${r.status === 429 ? 'Too Many Requests' : 'Service Unavailable'} - GET ${what}`)
      : err('E404', `404 Not Found - GET ${what}`));
    // node 20's fetch can leave a reset connection's promise unsettled with nothing keeping the process
    // alive; the loop then drains and the npm would exit 0. A drained loop is that reset: ECONNRESET.
    const get = (rel) => {
      const drained = new Promise((resolve) => process.once('beforeExit', () => resolve({ down: 'ECONNRESET' })));
      const asked = (async () => {
        try { const r = await fetch(new URL(rel, state.url), { signal: AbortSignal.timeout(10000) }); return { status: r.status, body: Buffer.from(await r.arrayBuffer()) }; } catch (e) { return { down: e?.cause?.code ?? 'ECONNRESET' }; }
      })();
      return Promise.race([asked, drained]);
    };
    if (words[0] === 'view') {
      const m = /^(@[^/@]+\/[^@]+|[^@]+)@(\d+\.\d+\.\d+)$/.exec(words[1] ?? '');
      if (!m) return err('EUSAGE', 'view takes <name>@<version> here');
      const r = await get(`${m[1].replace('/', '%2f')}/${m[2]}`);
      if (r.down) return err(r.down, `request to ${state.url} failed, reason: ${r.down}`);
      if (r.status >= 500 || r.status === 429) return notOk(r, `${state.url}${m[1]}`);
      if (r.status !== 200) return err('E404', `404 Not Found - GET ${state.url}${m[1]} - '${m[1]}@${m[2]}' is not in this registry.`);
      let v = JSON.parse(r.body);
      for (const field of words.slice(2)) for (const k of field.split('.')) v = v?.[k];
      say(args.includes('--json') || typeof v !== 'string' ? JSON.stringify(v, null, 2) : v);
      return 0;
    }
    const readPair = () => {
      const pj = JSON.parse(fs.readFileSync('package.json', 'utf8'));
      const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
      return { pj, lock };
    };
    if (words[0] === 'ci') {
      let pj, lock;
      try { ({ pj, lock } = readPair()); } catch { return err('EUSAGE', 'The `npm ci` command can only install with an existing package-lock.json'); }
      const deps = pj.dependencies ?? {};
      const entries = Object.entries(lock.packages ?? {}).filter(([k]) => k !== '');
      // what real npm refuses (spec S9): each dependency's lock entry there, of its version, with no dependencies
      const inSync = Object.entries(deps).every(([n, v]) => lock.packages?.[`node_modules/${n}`]?.version === v)
        && entries.every(([k, e]) => k.startsWith('node_modules/') && deps[k.slice(13)] === e.version && !e.dependencies);
      if (!inSync) return err('ENOTCACHED', '`npm ci` can only install packages when your package.json and package-lock.json or npm-shrinkwrap.json are in sync.');
      for (const [k, e] of entries) {
        if (!String(e.resolved).startsWith(PUBLIC)) return rule(`${k}'s resolved is on the public registry`);
        const r = await get(String(e.resolved).slice(PUBLIC.length));
        if (r.down) return err(r.down, `request to ${state.url} failed, reason: ${r.down}`);
        if (r.status !== 200) return notOk(r, e.resolved);
        const got = `sha512-${sha512(r.body).toString('base64')}`;
        if (e.integrity && got !== e.integrity) return err('EINTEGRITY', `sha512 integrity checksum failed when using sha512: wanted ${e.integrity} but got ${got}.`);
        if (args.includes('--dry-run')) continue;
        const to = path.join('node_modules', k.slice(13));
        const tmp = fs.mkdtempSync(path.join(state.scratch, 'x-'));
        fs.writeFileSync(path.join(tmp, 'p.tgz'), r.body);
        const x = spawnSync('tar', ['-xzf', 'p.tgz'], { cwd: tmp, encoding: 'utf8', timeout: 30000 });
        if (x.status !== 0) return err('ETAR', x.stderr || 'tar failed');
        fs.rmSync(to, { recursive: true, force: true });
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.renameSync(path.join(tmp, 'package'), to);
        fs.rmSync(tmp, { recursive: true, force: true });
      }
      say(`\nadded ${entries.length} package${entries.length === 1 ? '' : 's'} in 1s`);
      return 0;
    }
    if (words[0] === 'audit' && words[1] === 'signatures') {
      let lock;
      try { ({ lock } = readPair()); } catch { return err('ENOLOCK', 'found no dependencies to audit that were installed from a supported registry'); }
      const entries = Object.entries(lock.packages ?? {}).filter(([k]) => k !== '' && fs.existsSync(path.join(k, 'package.json')));
      if (!entries.length) return err('ENOAUDIT', 'found no dependencies to audit that were installed from a supported registry');
      let attested = 0;
      for (const [k, e] of entries) {
        if (state.fail === 'old-npm') continue;
        const m = await get(`${k.slice(13).replace('/', '%2f')}/${e.version}`);
        if (m.down) return err(m.down, `request to ${state.url} failed, reason: ${m.down}`);
        if (m.status !== 200) return notOk(m, `${state.url}${k.slice(13)}`);
        const advertised = JSON.parse(m.body).dist?.attestations;
        if (!advertised) continue;
        // as pacote: the advertised path, on the registry npm was given
        const at = new URL(advertised.url).pathname.slice(1);
        const r = await get(at);
        if (r.down) return err(r.down, `request to ${state.url} failed, reason: ${r.down}`);
        if (r.status !== 200) return notOk(r, `${state.url}${at}`);
        // the signature is the fake's to trust; the subject must be the package npm installed
        const want = Buffer.from(String(e.integrity).replace(/^sha512-/, ''), 'base64').toString('hex');
        const bundle = JSON.parse(r.body);
        const bad = bundle.attestations.some((a) => JSON.parse(Buffer.from(a.bundle.dsseEnvelope.payload, 'base64')).subject?.[0]?.digest?.sha512 !== want);
        if (bad) { say(`audited ${entries.length} package in 0s\n\n1 package has an invalid attestation:\n\n${k.slice(13)}@${e.version}`); return 1; }
        attested++;
      }
      say(`audited ${entries.length} package${entries.length === 1 ? '' : 's'} in 0s\n\n${entries.length} package${entries.length === 1 ? ' has a' : 's have'} verified registry signature${entries.length === 1 ? '' : 's'}${attested ? `\n\n${attested} package${attested === 1 ? ' has a' : 's have'} verified attestation${attested === 1 ? '' : 's'}` : ''}`);
      return 0;
    }
    return rule(`${words.join(' ') || args.join(' ')} isn't answered by the fake`);
  };
  try { status = await run(); } catch (e) { process.stderr.write(`fake npm: ${e?.stack ?? e}\n`); status = 1; }
  fs.appendFileSync(state.calls, `${JSON.stringify({ argv: args, cwd: process.cwd(), npm_env: npmEnv, status })}\n`);
  process.exitCode = status;
}

if (process.argv[1] && path.resolve(process.argv[1]) === SELF) {
  if (process.argv[2] === 'npm') await fakeNpm(process.argv[3], process.argv.slice(4));
  else if (process.argv[2] === 'serve') serve(process.argv[3]);
}
