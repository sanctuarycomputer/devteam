// kit-install@1's fake registry and fake npm (the contract is the comment above packagePinPair in
// docs/devteam/scripts/devteam.mjs). startFakeRegistry() serves test/fixtures/kit-install/registry/ on a
// loopback port as npm's registry does, and writes an `npm` that a test puts first on PATH. The fake npm
// answers --version, view, ci and audit signatures from that registry, and refuses a call that breaks
// the contract's calling rules, so a consumer's test sees the rule kept, not only the answer. Two kinds of
// refusal, told apart by their text:
//   `fake npm: … (kit-install@1)`  a contract rule (exactly one --registry= naming this registry, the
//                                  DEVTEAM_NPM_REGISTRY env() sets; --ignore-scripts; no npm_config_* or
//                                  NPM_CONFIG_* but two different empty config files); real npm takes these
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
//   // env() sets HOME to a folder of the fake's own, so nothing reaches the real ~/.devteam/hub/
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
//   hostile-env     env() adds npm_config_* and NPM_CONFIG_* variables that point npm elsewhere
//   server-error    every request is a 503 (an outage: unreachable to the kit, never a refusal)
//   attestation-gone
//                   manifests advertise attestations but the bundle is a 404 (real npm's audit fails E404)
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
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
export const FIXTURES = path.resolve(path.dirname(SELF), '..', 'fixtures', 'kit-install');
export const NAME = '@sanctuarycomputer/devteam';
export const PUBLIC = 'https://registry.npmjs.org/';
export const FAILURES = ['unreachable', 'integrity', 'no-attestation', 'repo', 'workflow', 'ref', 'commit', 'digest', 'old-npm', 'hostile-env', 'server-error', 'attestation-gone'];
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
const envelope = (st) => ({
  mediaType: 'application/vnd.dev.sigstore.bundle+json;version=0.2',
  verificationMaterial: { tlogEntries: [], note: 'a fake: no signature here verifies' },
  dsseEnvelope: { payload: Buffer.from(JSON.stringify(st)).toString('base64'), payloadType: 'application/vnd.in-toto+json', signatures: [{ sig: 'ZmFrZQ==', keyid: '' }] },
});
function attestations(p, fail) {
  const st = statement(p, fail);
  const pub = { _type: 'https://in-toto.io/Statement/v0.1', subject: st.subject, predicateType: PUBLISH, predicate: { name: NAME, version: p.version, registry: 'https://registry.npmjs.org' } };
  return { attestations: [{ predicateType: PUBLISH, bundle: envelope(pub) }, { predicateType: SLSA, bundle: envelope(st) }] };
}

// ---- the server -------------------------------------------------------------------------------
// The registry runs in a process of its own, so a test that blocks on spawnSync (running the kit, or npm)
// is still answered. The parent writes the state file and tells the child to read it again.
function serve(stateFile) {
  let state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  const pkgs = packages(state.commits);
  const server = http.createServer((req, res) => {
    const send = (status, type, body) => { res.writeHead(status, { 'content-type': type }); res.end(body); };
    const notFound = () => send(404, 'application/json', '{"error":"Not found"}\n');
    if (req.method !== 'GET') return notFound();
    if (state.fail === 'server-error') return send(503, 'application/json', '{"error":"Service Unavailable"}\n');
    let p;
    try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { return notFound(); }
    const at = /^\/-\/npm\/v1\/attestations\/(.+)@(\d+\.\d+\.\d+)$/.exec(p);
    if (at) {
      const pk = at[1] === NAME && pkgs.get(at[2]);
      if (!pk || state.fail === 'no-attestation' || state.fail === 'attestation-gone') return notFound();
      return send(200, 'application/json', JSON.stringify(attestations(pk, state.fail)));
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

export async function startFakeRegistry({ fail = null, commits = {} } = {}) {
  if (fail !== null && !FAILURES.includes(fail)) throw new Error(`fake registry: no failure called ${fail}`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-fake-registry-'));
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  const stateFile = path.join(dir, 'state.json');
  const callsFile = path.join(dir, 'calls.jsonl');
  // a HOME of the fake's own: a test's installs, hub tree included, never reach the real one
  const home = path.join(dir, 'home');
  fs.mkdirSync(home);
  const state = { url: null, fail, commits, calls: callsFile, scratch: dir };
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
  fs.writeFileSync(path.join(bin, 'npm'), `#!/bin/sh\nexec '${process.execPath.replace(/'/g, "'\\''")}' '${SELF.replace(/'/g, "'\\''")}' npm '${stateFile.replace(/'/g, "'\\''")}' "$@"\n`, { mode: 0o755 });
  return {
    url: state.url, port: first.port, bin, dir, home,
    // base's variables with this npm first on PATH and the registry named for the kit (a loopback URL,
    // the only kind DEVTEAM_NPM_REGISTRY may name); hostile-env adds npm config that points elsewhere
    env(baseEnv = process.env) {
      const e = { ...baseEnv, PATH: `${bin}${path.delimiter}${baseEnv.PATH ?? ''}`, DEVTEAM_NPM_REGISTRY: state.url, HOME: home };
      if (state.fail === 'hostile-env') {
        const evil = path.join(dir, 'evil-npmrc');
        fs.writeFileSync(evil, 'registry=http://127.0.0.1:9/\nignore-scripts=false\n');
        Object.assign(e, { npm_config_registry: 'http://127.0.0.1:9/', NPM_CONFIG_USERCONFIG: evil, npm_config_ignore_scripts: 'false' });
      }
      return e;
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
async function fakeNpm(stateFile, args) {
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
    const stray = Object.keys(npmEnv).filter((k) => !['npm_config_userconfig', 'npm_config_globalconfig'].includes(k));
    if (stray.length) return rule(`npm config from the environment reached npm: ${stray.sort().join(', ')}`);
    const u = npmEnv.npm_config_userconfig, g = npmEnv.npm_config_globalconfig;
    if (!u || !g) return rule('npm_config_userconfig and npm_config_globalconfig both name an empty file');
    if (path.resolve(u) === path.resolve(g)) return err('ECONFIG', `double-loading config "${g}" as "global", previously loaded as "user"`);
    for (const f of [u, g]) { let size; try { size = fs.statSync(f).size; } catch { size = -1; } if (size !== 0) return rule(`${f} is an empty file`); }
    const words = args.filter((a) => !a.startsWith('-'));
    // an answer that isn't 200: a 5xx or a 429 is npm's E<status> (an outage), anything else its E404
    const notOk = (r, what) => (r.status >= 500 || r.status === 429
      ? err(`E${r.status}`, `${r.status} ${r.status === 429 ? 'Too Many Requests' : 'Service Unavailable'} - GET ${what}`)
      : err('E404', `404 Not Found - GET ${what}`));
    const get = async (rel) => {
      try { const r = await fetch(new URL(rel, state.url), { signal: AbortSignal.timeout(10000) }); return { status: r.status, body: Buffer.from(await r.arrayBuffer()) }; } catch (e) { return { down: e?.cause?.code ?? 'ECONNRESET' }; }
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
