// box-pins: verify, check, bump and installed, against the kit's Dockerfile and stand-in upstreams.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { kit, write } from './lib/kit.mjs';
import { baseEnv, KIT, nowhere, REPO, tmp } from './lib/machine-fixture.mjs';

// ===== box-pins: the box image's tool pins in cloud/Dockerfile =====
// verify, check and bump run a copy of the kit in a repo that is the kit's own (so they run as KIT_VIEWS
// do, on a fork's CI too), against a copy of the Dockerfile whose pins are set to the values below: a
// real bump or hold in cloud/Dockerfile never changes what these tests expect.
const FIXED = { CLAUDE_CODE: '2.1.307', CLAUDE_SWAP: '1.0.0', GH: '2.104.0', TTYD: '1.7.7', MISE: 'v2026.10.17', UV: '0.13.7' };
const FIXED_RELEASE = 'v0.52.0';
const fixedSum = (arg) => crypto.createHash('sha256').update(arg).digest('hex');
const pinsRepo = path.join(tmp, 'pins-kit');
fs.mkdirSync(pinsRepo);
execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: pinsRepo });
execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:sanctuarycomputer/devteam.git'], { cwd: pinsRepo });
fs.cpSync(kit, path.join(pinsRepo, 'docs', 'devteam'), { recursive: true, filter: (p) => !/[\\/](project|run)([\\/]|$)/.test(p.slice(kit.length)) });
let pinsCopies = 0;
function pinsCopy(edit = (t) => t) {
  let t = fs.readFileSync(path.join(REPO, 'cloud', 'Dockerfile'), 'utf8')
    .replace(/^ARG ([A-Z_]+?)_VERSION=.*$/gm, (l, p) => (p in FIXED ? `ARG ${p}_VERSION=${FIXED[p]}` : l))
    .replace(/^ARG ([A-Z_]+_SHA256_(?:X86_64|AARCH64))=.*$/gm, (l, a) => `ARG ${a}=${fixedSum(a)}`)
    .replace(/^ARG DEVTEAM_RELEASE=.*$/m, `ARG DEVTEAM_RELEASE=${FIXED_RELEASE}`)
    .split('\n').filter((l) => !/^\s*#\s*hold\b/i.test(l)).join('\n');
  t = edit(t);
  const f = path.join(tmp, 'pins', `Dockerfile.${++pinsCopies}`);
  write(f, t);
  return f;
}
const PINS_CLEARED = ['DEVTEAM_IMAGE_HUB', 'DEVTEAM_KIT_RELEASE', 'DEVTEAM_BOX_TOOLS', 'DEVTEAM_PINS_NPM', 'DEVTEAM_PINS_PYPI', 'DEVTEAM_PINS_GITHUB', 'DEVTEAM_BOX_BIN', 'GH_TOKEN', 'GITHUB_TOKEN', 'UV_TOOL_DIR'];
const pinsEnv = (extra = {}) => { const e = { ...baseEnv }; for (const k of PINS_CLEARED) delete e[k]; return { ...e, ...extra }; };
const pinsKit = path.join(pinsRepo, 'docs', 'devteam', 'scripts', 'devteam.mjs');
const pins = (args, env = {}) => spawnSync(process.execPath, [pinsKit, 'box-pins', ...args], { cwd: pinsRepo, encoding: 'utf8', env: pinsEnv(env) });
const pinsAsync = (args, env = {}) => new Promise((resolve) => execFile(process.execPath, [pinsKit, 'box-pins', ...args], { cwd: pinsRepo, encoding: 'utf8', env: pinsEnv(env) }, (err, stdout, stderr) => resolve({ status: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout, stderr })));

test('box-pins verify: ok on the kit\'s own Dockerfile; exit 2 with none', () => {
  const ok = pins(['verify', '--dockerfile', path.join(REPO, 'cloud/Dockerfile')]);
  assert.equal(ok.status, 0, ok.stderr + ok.stdout);
  assert.match(ok.stdout, /^box-pins verify: ok, 6 tools, release v\d+\.\d+\.\d+$/m);
  assert.equal(pins(['verify', '--dockerfile', pinsCopy()]).status, 0, 'the fixed copy is a good file');
  const none = pins(['verify']);
  assert.equal(none.status, 2, none.stderr + none.stdout);
  assert.match(none.stdout + none.stderr, /no cloud\/Dockerfile at .*cloud\/Dockerfile/);
});

test('box-pins verify names each problem and exits 1', () => {
  const cases = [
    [(t) => t.replace(/^(ARG TTYD_SHA256_X86_64=)\w+$/m, '$1ABC'), /TTYD_SHA256_X86_64 is not 64 lowercase hex/],
    [(t) => t.replace(/^ARG GH_SHA256_AARCH64=\w+\n/m, ''), /gh has no GH_SHA256_AARCH64/],
    [(t) => t.replace(/^ARG DEVTEAM_RELEASE=.*$/m, 'ARG DEVTEAM_RELEASE=0.52'), /DEVTEAM_RELEASE 0\.52 is not vX\.Y\.Z/],
  ];
  for (const [edit, re] of cases) { const r = pins(['verify', '--dockerfile', pinsCopy(edit)]); assert.equal(r.status, 1, String(re)); assert.match(r.stdout, re); }
  const url = pins(['verify', '--dockerfile', pinsCopy((t) => t.replace('download/v$GH_VERSION/gh_${GH_VERSION}_linux', `download/v${FIXED.GH}/gh_${FIXED.GH}_linux`))]);
  assert.equal(url.status, 1); assert.match(url.stdout, /gh's version 2\.104\.0 is written outside its ARG \(line \d+: /);
  const rel = pins(['verify', '--release', 'v1.2.3', '--dockerfile', pinsCopy()]);
  assert.equal(rel.status, 1); assert.match(rel.stdout, /DEVTEAM_RELEASE is v0\.52\.0, not v1\.2\.3/);
  assert.equal(pins(['verify', '--release', FIXED_RELEASE, '--dockerfile', pinsCopy()]).status, 0);
});

test('verify does not count another tool\'s own ARG as a stray literal', () => {
  const f = pinsCopy((t) => t.replace(/^ARG TTYD_VERSION=.*$/m, `ARG TTYD_VERSION=${FIXED.CLAUDE_SWAP}`));
  const r = pins(['verify', '--dockerfile', f]);
  assert.equal(r.status, 0, r.stdout);
  const g = pinsCopy((t) => t.replace(/^(# ttyd, the web terminal)$/m, `$1 ${FIXED.CLAUDE_SWAP}`));
  assert.match(pins(['verify', '--dockerfile', g]).stdout, /claude-swap's version 1\.0\.0 is written outside its ARG/);
});

test('verify takes a hold above the _VERSION ARG, and refuses one with no reason, misplaced or misspelled', () => {
  assert.equal(pins(['verify', '--dockerfile', pinsCopy((t) => t.replace(/^ARG MISE_VERSION=/m, '# hold: waiting on a fix\n$&'))]).status, 0);
  const r = pins(['verify', '--dockerfile', pinsCopy((t) => t.replace(/^ARG MISE_VERSION=/m, '# hold:\n$&'))]);
  assert.equal(r.status, 1); assert.match(r.stdout, /mise's hold has no reason/);
  const far = pins(['verify', '--dockerfile', pinsCopy((t) => t.replace(/^# ttyd, the web terminal$/m, '# hold: bad build\n$&'))]);
  assert.equal(far.status, 1); assert.match(far.stdout, /the hold on line \d+ is not directly above a _VERSION ARG/);
  const odd = pins(['verify', '--dockerfile', pinsCopy((t) => t.replace(/^ARG MISE_VERSION=/m, '# Hold: x\n$&'))]);
  assert.equal(odd.status, 1); assert.match(odd.stdout, /line \d+ looks like a hold but is not "# hold: <reason>"/);
});

test('verify names what it found, where (task-1 review)', () => {
  const lineOf = (f, re) => fs.readFileSync(f, 'utf8').split('\n').findIndex((l) => re.test(l)) + 1;
  const run = (edit) => { const f = pinsCopy(edit); return { f, r: pins(['verify', '--dockerfile', f]) }; };
  // the stray's own text is shown, even deep in a long line
  const u = run((t) => t.replace('download/v$GH_VERSION/gh_${GH_VERSION}_linux', `download/v${FIXED.GH}/gh_${FIXED.GH}_linux`));
  assert.match(u.r.stdout, new RegExp(`gh's version 2\\.104\\.0 is written outside its ARG \\(line ${lineOf(u.f, /download\/v2\.104\.0/)}: .*v2\\.104\\.0/gh_2\\.104\\.0`));
  const sum = fixedSum('UV_SHA256_X86_64');
  const s1 = run((t) => t.replace('x86_64) sum=$UV_SHA256_X86_64', `x86_64) sum=${sum}`));
  assert.match(s1.r.stdout, new RegExp(`uv's UV_SHA256_X86_64 sum is written outside its ARG \\(line ${lineOf(s1.f, /x86_64\) sum=[0-9a-f]{64}/)}: .*${sum}`));
  // mise's version is searched without its v
  assert.match(run((t) => t.replace('-linux-$arch"', '-linux-$arch" # 2026.10.17')).r.stdout, /mise's version v2026\.10\.17 is written outside its ARG/);
  // a stamp or a hold naming a version is no stray
  assert.equal(run((t) => t.replace(/^ARG UV_VERSION=/m, '# hold: 0.13.8 breaks the build; stay on 0.13.7\n$&')).r.status, 0);
  // exactly "# hold: <reason>", unindented, right above the ARG
  const far = run((t) => t.replace(/^# ttyd, the web terminal$/m, '# hold: bad build\n$&'));
  assert.match(far.r.stdout, new RegExp(`the hold on line ${lineOf(far.f, /^# hold: bad build$/)} is not directly above a _VERSION ARG`));
  for (const bad of ['# hold:x', '  # hold: x', '#hold: x']) assert.match(run((t) => t.replace(/^ARG MISE_VERSION=/m, `${bad}\n$&`)).r.stdout, /looks like a hold but is not "# hold: <reason>"/, bad);
  // the ARGs: given twice, or empty
  assert.match(run((t) => t.replace(/^ARG UV_VERSION=.*$/m, '$&\n$&')).r.stdout, /uv's UV_VERSION is given 2 times/);
  assert.match(run((t) => t.replace(/^ARG UV_VERSION=.*$/m, 'ARG UV_VERSION=')).r.stdout, /uv's UV_VERSION is empty/);
  assert.match(run((t) => t.replace(/^ARG DEVTEAM_RELEASE=.*$/m, '')).r.stdout, /no DEVTEAM_RELEASE/);
  // DEVTEAM_BOX_TOOLS names exactly the six pins
  assert.match(run((t) => t.replace(' uv=$UV_VERSION', '')).r.stdout, /DEVTEAM_BOX_TOOLS does not name uv=\$UV_VERSION/);
  assert.match(run((t) => t.replace(' uv=$UV_VERSION', ' uv=$UV_VERSION node=$NODE_VERSION')).r.stdout, /DEVTEAM_BOX_TOOLS names node=\$NODE_VERSION, which is no tool's/);
  assert.match(run((t) => t.replace(/^\s*DEVTEAM_BOX_TOOLS=.*$/m, '    DEVTEAM_X=1')).r.stdout, /no DEVTEAM_BOX_TOOLS/);
  // a pin that isn't a plain version could never be compared: a problem, so check and bump refuse it
  assert.match(run((t) => t.replace(/^ARG UV_VERSION=.*$/m, 'ARG UV_VERSION=0.13.7-rc1')).r.stdout, /uv's UV_VERSION 0\.13\.7-rc1 is not a plain version/);
  // the stamp's line is no stray for a tool at the same number
  assert.equal(run((t) => t.replace(/^ARG UV_VERSION=.*$/m, 'ARG UV_VERSION=0.52.0')).r.status, 0);
  // a --release that isn't vX.Y.Z is a usage error
  const bad = pins(['verify', '--release', 'v1.2', '--dockerfile', pinsCopy()]);
  assert.equal(bad.status, 1); assert.match(bad.stderr, /--release "v1\.2" is not vX\.Y\.Z/); assert.match(bad.stderr, /usage: box-pins verify/);
});

// npm, PyPI and GitHub in one in-process server; downloads redirect to the bytes, as GitHub's do.
// Every tool's default latest is one release past FIXED; each asset's bytes are its own.
const LATEST = { 'claude-code': '2.1.308', 'claude-swap': '1.0.1', gh: 'v2.105.0', ttyd: '1.7.8', mise: 'v2026.11.8', uv: '0.13.8' };
const REPOS = { gh: 'cli/cli', ttyd: 'tsl0922/ttyd', mise: 'jdx/mise', uv: 'astral-sh/uv' };
const assetNames = (tool, tag) => ({
  gh: [`gh_${tag.replace(/^v/, '')}_linux_amd64.tar.gz`, `gh_${tag.replace(/^v/, '')}_linux_arm64.tar.gz`],
  ttyd: ['ttyd.x86_64', 'ttyd.aarch64'],
  mise: [`mise-${tag}-linux-x64`, `mise-${tag}-linux-arm64`],
  uv: ['uv-x86_64-unknown-linux-gnu.tar.gz', 'uv-aarch64-unknown-linux-gnu.tar.gz'],
}[tool]);
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
async function upstream(t) {
  const state = { npm: { '@anthropic-ai/claude-code': LATEST['claude-code'] }, pypi: { 'claude-swap': LATEST['claude-swap'] }, releases: {}, assets: {}, hits: [] };
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    state.hits.push({ path: u.pathname, headers: req.headers });
    const json = (o, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(typeof o === 'string' ? o : JSON.stringify(o)); };
    let m;
    if (u.pathname.startsWith('/npm/') && !req.url.includes('%2f')) return json({}, 404);
    if (u.pathname.startsWith('/gh/') && (u.searchParams.get('per_page') !== '30' || req.headers.accept !== 'application/vnd.github+json')) return json({}, 400);
    if (state.hang?.(u.pathname)) return;
    if (state.stall?.(u.pathname)) { res.writeHead(200, { 'content-length': '1000' }); return res.write('part of a body'); }
    if ((m = /^\/npm\/(.+)\/latest$/.exec(u.pathname))) { const v = state.npm[decodeURIComponent(m[1])]; return v === undefined ? json({}, 404) : v.status ? json({}, v.status) : json({ version: v }); }
    if ((m = /^\/pypi\/pypi\/([^/]+)\/json$/.exec(u.pathname))) { const v = state.pypi[m[1]]; return v === undefined ? json({}, 404) : v.status ? json({}, v.status) : json({ info: { version: v } }); }
    if ((m = /^\/gh\/repos\/([^/]+\/[^/]+)\/releases$/.exec(u.pathname))) { const v = state.releases[m[1]]; return v === undefined ? json([], 404) : v.status ? json({}, v.status) : v.raw !== undefined ? json(v.raw) : json(v); }
    if ((m = /^\/dl\/(.+)$/.exec(u.pathname))) { res.writeHead(302, { location: `/assets/${m[1]}` }); return res.end(); }
    if ((m = /^\/assets\/(.+)$/.exec(u.pathname))) { const a = state.assets[m[1]]; if (!a || a.status) { res.writeHead(a?.status ?? 404); return res.end(); } res.writeHead(200); return res.end(a.body); }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  srv.unref();
  t.after(() => { srv.closeAllConnections?.(); srv.close(); });
  const url = `http://127.0.0.1:${srv.address().port}`;
  // a release of tool at tag, with both arch assets served, and a digest of their real bytes
  const release = (tool, tag, extra = {}) => ({ tag_name: tag, draft: false, prerelease: false, ...extra, assets: assetNames(tool, tag).map((name) => {
    const key = `${REPOS[tool]}/${name}`;
    const body = `${key}/${tag}`;
    state.assets[key] = { body };
    return { name, browser_download_url: `${url}/dl/${key}`, digest: `sha256:${sha256(body)}` };
  }) });
  for (const tool of Object.keys(REPOS)) state.releases[REPOS[tool]] = [release(tool, LATEST[tool])];
  return { url, state, release };
}
const upEnv = (u) => ({ DEVTEAM_PINS_NPM: `${u.url}/npm`, DEVTEAM_PINS_PYPI: `${u.url}/pypi`, DEVTEAM_PINS_GITHUB: `${u.url}/gh` });
const closedPort = async () => { const s = net.createServer(); await new Promise((r) => s.listen(0, '127.0.0.1', r)); const p = s.address().port; await new Promise((r) => s.close(r)); return p; };

test('box-pins check: one line per tool; stale exits 1; held, current; --json the same', async (t) => {
  const u = await upstream(t);
  const f = pinsCopy();
  const r = await pinsAsync(['check', '--dockerfile', f], upEnv(u));
  assert.equal(r.status, 1, r.stderr + r.stdout);
  assert.deepEqual(r.stdout.trim().split('\n'), [
    'claude-code: stale 2.1.307 -> 2.1.308', 'claude-swap: stale 1.0.0 -> 1.0.1', 'gh: stale 2.104.0 -> 2.105.0',
    'ttyd: stale 1.7.7 -> 1.7.8', 'mise: stale v2026.10.17 -> v2026.11.8', 'uv: stale 0.13.7 -> 0.13.8',
  ]);
  // everything current but gh, which is held: nothing asked of cli/cli, exit 0
  u.state.npm['@anthropic-ai/claude-code'] = FIXED.CLAUDE_CODE;
  u.state.pypi['claude-swap'] = FIXED.CLAUDE_SWAP;
  for (const [tool, p] of [['ttyd', 'TTYD'], ['mise', 'MISE'], ['uv', 'UV']]) u.state.releases[REPOS[tool]] = [u.release(tool, FIXED[p])];
  u.state.hits.length = 0;
  const held = pinsCopy((x) => x.replace(/^ARG GH_VERSION=/m, '# hold: 2.105 breaks auth\n$&'));
  const c = await pinsAsync(['check', '--dockerfile', held], upEnv(u));
  assert.equal(c.status, 0, c.stderr + c.stdout);
  assert.deepEqual(c.stdout.trim().split('\n'), ['claude-code: current 2.1.307', 'claude-swap: current 1.0.0', 'gh: held 2.105 breaks auth', 'ttyd: current 1.7.7', 'mise: current v2026.10.17', 'uv: current 0.13.7']);
  assert.ok(!u.state.hits.some((h) => h.path.includes('cli/cli')), 'a held tool is not asked about');
  const j = await pinsAsync(['check', '--json', '--dockerfile', held], upEnv(u));
  assert.equal(j.status, 0);
  const o = JSON.parse(j.stdout);
  assert.equal(o.box_pins, 1);
  assert.deepEqual(o.tools.map((x) => [x.name, x.status]), [['claude-code', 'current'], ['claude-swap', 'current'], ['gh', 'held'], ['ttyd', 'current'], ['mise', 'current'], ['uv', 'current']]);
  assert.equal(o.tools[2].reason, '2.105 breaks auth');
  const sj = JSON.parse((await pinsAsync(['check', '--json', '--dockerfile', f], upEnv(u))).stdout);
  assert.deepEqual(sj.tools.find((x) => x.name === 'gh'), { name: 'gh', pinned: '2.104.0', status: 'stale', latest: '2.105.0' });
});

test('check ignores a GitHub prerelease and a draft, and takes the highest release, not the newest entry', async (t) => {
  const u = await upstream(t);
  u.state.releases['tsl0922/ttyd'] = [u.release('ttyd', '1.9.0', { prerelease: true }), u.release('ttyd', '2.0.0', { draft: true }), u.release('ttyd', '1.6.9'), u.release('ttyd', '1.7.8')];
  const r = await pinsAsync(['check', '--dockerfile', pinsCopy()], upEnv(u));
  assert.match(r.stdout, /^ttyd: stale 1\.7\.7 -> 1\.7\.8$/m);
});

test('check reports an unreachable upstream as unknown, and junk as unknown, never raw', async (t) => {
  const u = await upstream(t);
  for (const [tool, p] of [['gh', 'GH'], ['ttyd', 'TTYD'], ['mise', 'MISE'], ['uv', 'UV']]) u.state.releases[REPOS[tool]] = [u.release(tool, tool === 'gh' ? `v${FIXED[p]}` : FIXED[p])];
  u.state.pypi['claude-swap'] = '1.2.3\u001b[2J';
  const r = await pinsAsync(['check', '--dockerfile', pinsCopy()], { ...upEnv(u), DEVTEAM_PINS_NPM: `http://127.0.0.1:${await closedPort()}` });
  assert.equal(r.status, 3, r.stderr + r.stdout);
  assert.match(r.stdout, /^claude-code: unknown unreachable/m);
  assert.match(r.stdout, /^claude-swap: unknown not a release: \?$/m);
  assert.match(r.stdout, /^gh: current 2\.104\.0$/m);
  assert.ok(!r.stdout.includes('\u001b'));
  u.state.releases['jdx/mise'] = { status: 500 };
  assert.match((await pinsAsync(['check', '--dockerfile', pinsCopy()], upEnv(u))).stdout, /^mise: unknown HTTP 500$/m);
});

test('check: stale wins over unknown; no release, bad JSON and a timeout are unknown (task-2 review)', async (t) => {
  const u = await upstream(t);
  u.state.releases['tsl0922/ttyd'] = [u.release('ttyd', '1.9.0', { prerelease: true })];
  u.state.releases['jdx/mise'] = { raw: 'not json' };
  u.state.hang = (p) => p.includes('astral-sh/uv');
  const r = await pinsAsync(['check', '--dockerfile', pinsCopy()], { ...upEnv(u), DEVTEAM_PINS_TIMEOUT_MS: '500' });
  assert.equal(r.status, 1, 'a stale pin decides the exit, whatever else is unknown');
  assert.match(r.stdout, /^gh: stale /m);
  assert.match(r.stdout, /^ttyd: unknown no release$/m);
  assert.match(r.stdout, /^mise: unknown bad JSON$/m);
  assert.match(r.stdout, /^uv: unknown unreachable \(timed out\)$/m);
  const j = await pinsAsync(['check', '--json', '--dockerfile', pinsCopy()], { ...upEnv(u), DEVTEAM_PINS_TIMEOUT_MS: '500' });
  assert.equal(j.status, 1);
});

test('check sends GH_TOKEN to the GitHub API, and nowhere else', async (t) => {
  const u = await upstream(t);
  await pinsAsync(['check', '--dockerfile', pinsCopy()], { ...upEnv(u), GH_TOKEN: 'fake-token' });
  const gh = u.state.hits.filter((h) => h.path.startsWith('/gh/'));
  assert.equal(gh.length, 4);
  for (const h of gh) assert.equal(h.headers.authorization, 'Bearer fake-token');
  for (const h of u.state.hits.filter((x) => !x.path.startsWith('/gh/'))) assert.equal(h.headers.authorization, undefined, h.path);
  u.state.hits.length = 0;
  await pinsAsync(['check', '--dockerfile', pinsCopy()], upEnv(u));
  for (const h of u.state.hits) assert.equal(h.headers.authorization, undefined, 'none without GH_TOKEN');
});

test('check on a broken file exits 2 with its problems, in --json too', async (t) => {
  const u = await upstream(t);
  const f = pinsCopy((x) => x.replace(/^ARG TTYD_SHA256_X86_64=\w+\n/m, ''));
  const r = await pinsAsync(['check', '--dockerfile', f], upEnv(u));
  assert.equal(r.status, 2);
  assert.match(r.stdout, /^box-pins check: ttyd has no TTYD_SHA256_X86_64$/m);
  const j = await pinsAsync(['check', '--json', '--dockerfile', f], upEnv(u));
  assert.equal(j.status, 2);
  assert.deepEqual(JSON.parse(j.stdout), { box_pins: 1, problems: ['ttyd has no TTYD_SHA256_X86_64'] });
  assert.equal(u.state.hits.length, 0, 'nothing asked of upstream');
});

const argOf = (text, name) => new RegExp(`^ARG ${name}=(.*)$`, 'm').exec(text)?.[1];
const fileSha = (f) => sha256(fs.readFileSync(f));
const assetBody = (tool, tag, i) => `${REPOS[tool]}/${assetNames(tool, tag)[i]}/${tag}`;

test('box-pins bump --release v9.9.9 sets each unheld tool to latest with the assets\' real sums', async (t) => {
  const u = await upstream(t);
  const f = pinsCopy((x) => x.replace(/^ARG UV_VERSION=/m, '# hold: 0.13.8 breaks claude-swap\n$&'));
  const before = fs.readFileSync(f, 'utf8');
  const r = await pinsAsync(['bump', '--release', 'v9.9.9', '--dockerfile', f], upEnv(u));
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const after = fs.readFileSync(f, 'utf8');
  assert.deepEqual(['CLAUDE_CODE', 'CLAUDE_SWAP', 'GH', 'TTYD', 'MISE', 'UV'].map((p) => argOf(after, `${p}_VERSION`)), ['2.1.308', '1.0.1', '2.105.0', '1.7.8', 'v2026.11.8', FIXED.UV]);
  for (const [tool, p] of [['gh', 'GH'], ['ttyd', 'TTYD'], ['mise', 'MISE']]) {
    assert.equal(argOf(after, `${p}_SHA256_X86_64`), sha256(assetBody(tool, LATEST[tool], 0)), `${tool} x86_64`);
    assert.equal(argOf(after, `${p}_SHA256_AARCH64`), sha256(assetBody(tool, LATEST[tool], 1)), `${tool} aarch64`);
  }
  for (const a of ['UV_VERSION', 'UV_SHA256_X86_64', 'UV_SHA256_AARCH64']) assert.equal(argOf(after, a), argOf(before, a), `held uv keeps ${a}`);
  assert.match(after, /^# hold: 0\.13\.8 breaks claude-swap\nARG UV_VERSION=/m);
  assert.ok(!u.state.hits.some((h) => h.path.includes('astral-sh/uv')), 'nothing asked about a held tool');
  assert.equal(argOf(after, 'DEVTEAM_RELEASE'), 'v9.9.9');
  assert.match(r.stdout, /^TTYD_VERSION 1\.7\.7 -> 1\.7\.8$/m);
  assert.match(r.stdout, /^held uv: 0\.13\.8 breaks claude-swap$/m);
  assert.match(r.stdout, new RegExp(`^wrote ${f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));
  const notArg = (x) => x.split('\n').filter((l) => !l.startsWith('ARG '));
  assert.deepEqual(notArg(after), notArg(before), 'only ARG lines were rewritten');
  assert.equal(pins(['verify', '--release', 'v9.9.9', '--dockerfile', f]).status, 0);
});

test('bump --dry-run prints the change and leaves the file byte-identical', async (t) => {
  const u = await upstream(t);
  const f = pinsCopy();
  const sum = fileSha(f);
  const r = await pinsAsync(['bump', '--release', 'v9.9.9', '--dry-run', '--dockerfile', f], upEnv(u));
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /^TTYD_VERSION 1\.7\.7 -> 1\.7\.8$/m);
  assert.match(r.stdout, new RegExp(`^TTYD_SHA256_X86_64 ${fixedSum('TTYD_SHA256_X86_64')} -> ${sha256(assetBody('ttyd', '1.7.8', 0))}$`, 'm'));
  assert.match(r.stdout, /^DEVTEAM_RELEASE v0\.52\.0 -> v9\.9\.9$/m);
  assert.match(r.stdout, /^--dry-run: nothing written$/m);
  assert.equal(fileSha(f), sum);
});

test('bump writes nothing when an upstream fails, or a digest disagrees', async (t) => {
  const u = await upstream(t);
  const f = pinsCopy();
  const sum = fileSha(f);
  u.state.assets[`cli/cli/${assetNames('gh', LATEST.gh)[1]}`] = { status: 500 };
  const r = await pinsAsync(['bump', '--release', 'v9.9.9', '--dockerfile', f], upEnv(u));
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stderr, /box-pins bump: gh: .*500.*; nothing written/);
  assert.equal(fileSha(f), sum);
  u.state.assets[`cli/cli/${assetNames('gh', LATEST.gh)[1]}`] = { body: assetBody('gh', LATEST.gh, 1) };
  u.state.releases['jdx/mise'][0].assets[0].digest = `sha256:${'0'.repeat(64)}`;
  const d = await pinsAsync(['bump', '--release', 'v9.9.9', '--dockerfile', f], upEnv(u));
  assert.equal(d.status, 1, d.stdout);
  assert.match(d.stderr, /box-pins bump: mise: .*digest.*; nothing written/);
  assert.equal(fileSha(f), sum);
  u.state.releases['jdx/mise'][0].assets[0].digest = `sha256:${sha256(assetBody('mise', LATEST.mise, 0))}`;
  u.state.npm['@anthropic-ai/claude-code'] = { status: 503 };
  const n = await pinsAsync(['bump', '--release', 'v9.9.9', '--dockerfile', f], upEnv(u));
  assert.equal(n.status, 1);
  assert.match(n.stderr, /box-pins bump: claude-code: HTTP 503; nothing written/);
  assert.equal(fileSha(f), sum);
});

test('bump sends no token with a download', async (t) => {
  const u = await upstream(t);
  const r = await pinsAsync(['bump', '--release', 'v9.9.9', '--dockerfile', pinsCopy()], { ...upEnv(u), GH_TOKEN: 'fake-token' });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.ok(u.state.hits.some((h) => h.path.startsWith('/dl/')) && u.state.hits.some((h) => h.path.startsWith('/assets/')), 'downloads went through the redirect');
  for (const h of u.state.hits) {
    if (h.path.startsWith('/gh/')) assert.equal(h.headers.authorization, 'Bearer fake-token');
    else assert.equal(h.headers.authorization, undefined, h.path);
  }
});

test('bump keeps the file\'s mode, and writes nothing when nothing changes', async (t) => {
  const u = await upstream(t);
  const f = pinsCopy();
  fs.chmodSync(f, 0o664); // group-writable: a umask of 022 alone would lose it
  assert.equal((await pinsAsync(['bump', '--release', 'v9.9.9', '--dockerfile', f], upEnv(u))).status, 0);
  assert.equal(fs.statSync(f).mode & 0o777, 0o664);
  const { mtimeMs } = fs.statSync(f);
  const sum = fileSha(f);
  const again = await pinsAsync(['bump', '--release', 'v9.9.9', '--dockerfile', f], upEnv(u));
  assert.equal(again.status, 0, again.stderr);
  assert.match(again.stdout, /^unchanged$/m);
  assert.equal(fileSha(f), sum);
  assert.equal(fs.statSync(f).mtimeMs, mtimeMs);
  assert.deepEqual(fs.readdirSync(path.dirname(f)).filter((x) => x.endsWith('.tmp')), [], 'no temp file left');
});

test('bump and check refuse a malformed hold', async (t) => {
  const u = await upstream(t);
  const f = pinsCopy((x) => x.replace(/^ARG MISE_VERSION=/m, '# Hold: x\n$&'));
  const sum = fileSha(f);
  const b = await pinsAsync(['bump', '--release', 'v9.9.9', '--dockerfile', f], upEnv(u));
  assert.equal(b.status, 1);
  assert.match(b.stdout, /box-pins bump: line \d+ looks like a hold but is not "# hold: <reason>"/);
  assert.equal(fileSha(f), sum);
  assert.equal((await pinsAsync(['check', '--dockerfile', f], upEnv(u))).status, 2);
  assert.equal(u.state.hits.length, 0, 'nothing asked of upstream');
});

test('bump refuses a --release older than the stamp, and needs one', async (t) => {
  const u = await upstream(t);
  const f = pinsCopy();
  const sum = fileSha(f);
  const r = await pinsAsync(['bump', '--release', 'v0.1.0', '--dockerfile', f], upEnv(u));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--release v0\.1\.0 is older than DEVTEAM_RELEASE v0\.52\.0/);
  const none = await pinsAsync(['bump', '--dockerfile', f], upEnv(u));
  assert.equal(none.status, 1);
  assert.match(none.stderr, /usage: box-pins/);
  assert.equal(fileSha(f), sum);
  assert.equal(u.state.hits.length, 0);
});

test('bump writes nothing that would not verify, says a failed download in its own words, and bumps a symlink\'s target (task-3 review)', async (t) => {
  const u = await upstream(t);
  // a comment already naming ttyd's next version becomes a stray once ttyd moves to it
  const f = pinsCopy((x) => x.replace(/^# ttyd, the web terminal$/m, '$& (1.7.8 fixes resize)'));
  const sum = fileSha(f);
  const r = await pinsAsync(['bump', '--release', 'v9.9.9', '--dockerfile', f], upEnv(u));
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stderr, /box-pins bump: the result would not verify \(ttyd's version 1\.7\.8 is written outside its ARG .*\); nothing written/);
  assert.equal(fileSha(f), sum);
  // a refused download: our words and the error code, not Node's message
  for (const n of assetNames('uv', LATEST.uv)) u.state.releases['astral-sh/uv'][0].assets.find((a) => a.name === n).browser_download_url = `http://127.0.0.1:${await closedPort()}/x`;
  const d = await pinsAsync(['bump', '--release', 'v9.9.9', '--dockerfile', pinsCopy()], upEnv(u));
  assert.equal(d.status, 1);
  assert.match(d.stderr, /box-pins bump: uv: download of uv-x86_64-unknown-linux-gnu\.tar\.gz failed \(ECONNREFUSED\); nothing written/);
  // a download whose body stalls after its headers: timed out
  u.state.releases['astral-sh/uv'] = [u.release('uv', LATEST.uv)];
  u.state.stall = (p) => p.startsWith('/assets/astral-sh/');
  const h = await pinsAsync(['bump', '--release', 'v9.9.9', '--dockerfile', pinsCopy()], { ...upEnv(u), DEVTEAM_PINS_TIMEOUT_MS: '500' });
  assert.equal(h.status, 1);
  assert.match(h.stderr, /box-pins bump: uv: download of .* failed \(timed out\); nothing written/);
  u.state.stall = null;
  // --dockerfile a symlink: its target is bumped and the link stays a link
  const target = pinsCopy();
  const link = path.join(path.dirname(target), 'Dockerfile.link');
  fs.symlinkSync(target, link);
  const l = await pinsAsync(['bump', '--release', 'v9.9.9', '--dockerfile', link], upEnv(u));
  assert.equal(l.status, 0, l.stderr);
  assert.ok(fs.lstatSync(link).isSymbolicLink());
  assert.equal(argOf(fs.readFileSync(target, 'utf8'), 'DEVTEAM_RELEASE'), 'v9.9.9');
});

test('bump downloads nothing for a tool already current', async (t) => {
  const u = await upstream(t);
  u.state.releases['tsl0922/ttyd'] = [u.release('ttyd', FIXED.TTYD)];
  for (const n of assetNames('ttyd', FIXED.TTYD)) u.state.assets[`tsl0922/ttyd/${n}`] = { status: 500 };
  const f = pinsCopy();
  const before = fs.readFileSync(f, 'utf8');
  const r = await pinsAsync(['bump', '--release', 'v9.9.9', '--dockerfile', f], upEnv(u));
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.ok(!u.state.hits.some((h) => /^\/(dl|assets)\/tsl0922\//.test(h.path)), 'no ttyd download');
  const after = fs.readFileSync(f, 'utf8');
  for (const a of ['TTYD_VERSION', 'TTYD_SHA256_X86_64', 'TTYD_SHA256_AARCH64']) assert.equal(argOf(after, a), argOf(before, a));
});

// installed, as the image runs it: the image's kit (a folder that is no repo), from a cwd that is no
// repo, each tool by its path in the image (here DEVTEAM_BOX_BIN), and a PATH whose first uv is
// mise's shim, which a lookup through PATH would wrongly ask.
const imageKit = path.join(tmp, 'image-kit');
fs.cpSync(kit, imageKit, { recursive: true, filter: (p) => !/[\\/](project|run)([\\/]|$)/.test(p.slice(kit.length)) });
const TOOLS_ENV = 'claude-code=2.1.307 claude-swap=1.0.0 gh=2.104.0 ttyd=1.7.7 mise=v2026.10.17 uv=0.13.7';
function fakeBins(name, scripts) {
  const d = path.join(tmp, name);
  for (const [f, body] of Object.entries(scripts)) { write(path.join(d, f), `#!/bin/sh\n${body}\n`); fs.chmodSync(path.join(d, f), 0o755); }
  return d;
}
const say = (s) => `printf '%s\\n' ${s.split('\n').map((l) => `'${l}'`).join(' ')}`;
const boxBin = fakeBins('box-bin', {
  claude: say('2.1.307 (Claude Code)'),
  gh: say('gh version 2.104.0 (2026-10-01)\nhttps://github.com/cli/cli/releases/tag/v2.104.0'),
  ttyd: say('ttyd version 1.7.7-40e79c7'),
  mise: say('2026.10.17 linux-x64 (2026-10-21)'),
  uv: `case "$1" in
  --version) ${say('uv 0.13.7 (x86_64-unknown-linux-gnu)')} ;;
  tool) if [ "$UV_TOOL_DIR" = /opt/uv/tools ]; then ${say('claude-swap v1.0.0\n- claude-swap\n- cswap')}; else echo 'No tools installed'; fi ;;
  *) exit 2 ;;
esac`,
});
const shimBin = fakeBins('shim-bin', { claude: say('9.9.9 (Claude Code)'), gh: say('gh version 9.9.9'), ttyd: say('ttyd version 9.9.9'), mise: say('9.9.9 linux-x64'), uv: `[ "$1" = tool ] && ${say('claude-swap v9.9.9')} || ${say('uv 0.9.0 (mise shim)')}` });
const installed = (env) => spawnSync(process.execPath, [path.join(imageKit, 'scripts', 'devteam.mjs'), 'box-pins', 'installed'], { cwd: nowhere, encoding: 'utf8', env: pinsEnv({ PATH: `${shimBin}${path.delimiter}${baseEnv.PATH}`, ...env }) });

test('box-pins installed reads each tool by its image path and claude-swap from the image\'s tool dir', () => {
  const r = installed({ DEVTEAM_BOX_BIN: boxBin, DEVTEAM_BOX_TOOLS: TOOLS_ENV });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.deepEqual(r.stdout.trim().split('\n'), ['claude-code: 2.1.307', 'claude-swap: 1.0.0', 'gh: 2.104.0', 'ttyd: 1.7.7', 'mise: v2026.10.17', 'uv: 0.13.7']);
  // the same from inside a worker's checkout, with its session's run folder: still the machine's command
  const w = installed({ DEVTEAM_BOX_BIN: boxBin, DEVTEAM_BOX_TOOLS: TOOLS_ENV, DEVTEAM_RUN: path.join(tmp, 'elsewhere', 'run') });
  assert.equal(w.status, 0, w.stderr);
});

test('installed exits 1 naming the tool that differs, or is missing', () => {
  const r = installed({ DEVTEAM_BOX_BIN: boxBin, DEVTEAM_BOX_TOOLS: TOOLS_ENV.replace('gh=2.104.0', 'gh=2.105.0') });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /^gh: installed 2\.104\.0, pinned 2\.105\.0$/m);
  assert.match(r.stdout, /^uv: 0\.13\.7$/m);
  const partial = fakeBins('box-bin-no-ttyd', Object.fromEntries(['claude', 'gh', 'mise', 'uv'].map((f) => [f, `exec '${path.join(boxBin, f)}' "$@"`])));
  const m = installed({ DEVTEAM_BOX_BIN: partial, DEVTEAM_BOX_TOOLS: TOOLS_ENV });
  assert.equal(m.status, 1);
  assert.match(m.stdout, /^ttyd: did not run \(ENOENT\)$/m);
  const odd = installed({ DEVTEAM_BOX_BIN: boxBin, DEVTEAM_BOX_TOOLS: `${TOOLS_ENV.replace(' uv=0.13.7', '')} node=22.1.0` });
  assert.equal(odd.status, 1);
  assert.match(odd.stdout, /^uv: not in DEVTEAM_BOX_TOOLS$/m);
  assert.match(odd.stdout, /^node: not a tool box-pins knows$/m);
});

test('installed runs from a repo that is no project, never looks a tool up on PATH, and names a pin given twice (task-4 review)', () => {
  const repoDir = path.join(tmp, 'not-a-project');
  fs.mkdirSync(repoDir, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: repoDir });
  const r = spawnSync(process.execPath, [path.join(imageKit, 'scripts', 'devteam.mjs'), 'box-pins', 'installed'], { cwd: repoDir, encoding: 'utf8', env: pinsEnv({ PATH: `${shimBin}${path.delimiter}${baseEnv.PATH}`, DEVTEAM_BOX_BIN: boxBin, DEVTEAM_BOX_TOOLS: TOOLS_ENV }) });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  // a relative DEVTEAM_BOX_BIN is a folder, never a bare name for PATH to find
  const rel = spawnSync(process.execPath, [path.join(imageKit, 'scripts', 'devteam.mjs'), 'box-pins', 'installed'], { cwd: boxBin, encoding: 'utf8', env: pinsEnv({ PATH: `${shimBin}${path.delimiter}${baseEnv.PATH}`, DEVTEAM_BOX_BIN: '.', DEVTEAM_BOX_TOOLS: TOOLS_ENV }) });
  assert.equal(rel.status, 0, rel.stdout);
  const twice = installed({ DEVTEAM_BOX_BIN: boxBin, DEVTEAM_BOX_TOOLS: `${TOOLS_ENV} gh=2.105.0` });
  assert.equal(twice.status, 1);
  assert.match(twice.stdout, /^gh: named 2 times in DEVTEAM_BOX_TOOLS$/m);
});

test('installed without DEVTEAM_BOX_TOOLS exits 2', () => {
  const r = installed({ DEVTEAM_BOX_BIN: boxBin });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /box-pins installed: DEVTEAM_BOX_TOOLS is not set \(not the box image\?\)/);
});

test('help names box-pins and says only the top package of npm and PyPI tools is pinned', () => {
  const r = spawnSync(process.execPath, [KIT, 'help'], { cwd: nowhere, encoding: 'utf8', env: pinsEnv() });
  assert.equal(r.status, 0, r.stderr);
  for (const re of [/box-pins verify \[--release vX\.Y\.Z\]/, /check \[--json\]/, /bump --release vX\.Y\.Z \[--dry-run\]/, /box-pins installed/, /only the top package of the npm and PyPI tools is pinned/i]) assert.match(r.stdout, re);
});

// ===== box-pins changed: what a release range changes in what the box image runs (image-changes@1) =====
// A kit repo made from this checkout's tracked tree (the working tree's copy, so the change under
// test is in it), tagged v9.1.0; each case is a branch off the tag with one commit, run with that
// branch's own script, as a release script or the deploy gate runs it from a checkout at --to.
const SCRIPT = 'docs/devteam/scripts/devteam.mjs';
const GIT_ID = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
const changedRepo = path.join(tmp, 'changed-kit');
const cg = (args) => execFileSync('git', args, { cwd: changedRepo, encoding: 'utf8', env: { ...pinsEnv(), ...GIT_ID } });
let changedBuilt = false;
function changedKit() {
  if (changedBuilt) return changedRepo;
  fs.mkdirSync(changedRepo);
  cg(['init', '-q', '-b', 'main']);
  cg(['remote', 'add', 'origin', 'git@github.com:sanctuarycomputer/devteam.git']);
  for (const f of execFileSync('git', ['ls-files', '-z'], { cwd: REPO, encoding: 'utf8' }).split('\0').filter(Boolean)) {
    const from = path.join(REPO, f), to = path.join(changedRepo, f);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    const st = fs.lstatSync(from, { throwIfNoEntry: false });
    if (!st) continue; // deleted in the working tree, not yet committed
    if (st.isSymbolicLink()) fs.symlinkSync(fs.readlinkSync(from), to);
    else fs.copyFileSync(from, to), fs.chmodSync(to, st.mode & 0o777);
  }
  cg(['add', '-A']);
  cg(['commit', '-qm', 'v9.1.0']);
  cg(['tag', 'v9.1.0']);
  changedBuilt = true;
  return changedRepo;
}
// edits: { path: (text) => text | null (delete) }, or a function given the repo for anything else
function onBranch(name, edits, from = 'v9.1.0') {
  changedKit();
  cg(['checkout', '-q', '-B', name, from]);
  if (typeof edits === 'function') edits(changedRepo);
  else for (const [f, fn] of Object.entries(edits)) {
    const p = path.join(changedRepo, f);
    const t = fn(fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '');
    if (t === null) fs.rmSync(p); else write(p, t);
  }
  cg(['add', '-A']);
  cg(['commit', '-qm', name]);
  return cg(['rev-parse', 'HEAD']).trim();
}
// one edit to the script: text after an anchor that must occur exactly once
const after = (anchor, add) => (t) => { assert.equal(t.split(anchor).length, 2, `anchor ${anchor} once`); return t.replace(anchor, () => `${anchor}${add}`); };
const changed = (args, env = {}) => spawnSync(process.execPath, [path.join(changedRepo, SCRIPT), 'box-pins', 'changed', ...args], { cwd: changedRepo, encoding: 'utf8', env: pinsEnv(env), timeout: 600000 });
const append = (s) => (t) => `${t}${s}`;

test('box-pins changed: dashboards, process docs, an unlisted declaration and a new command are a patch', () => {
  onBranch('patch', {
    'docs/devteam/dashboard/index.html': append('<!-- kit-671 probe -->\n'),
    'docs/devteam/process/supervisor.md': append('\nkit-671 probe.\n'),
    [SCRIPT]: (t) => after("  dashboard: cmdDashboard,", " 'kit-671-probe': cmdTimeline,")(after('function cmdTimeline() {\n', '  // kit-671 probe\n')(t)),
  });
  const r = changed(['--since', 'v9.1.0']);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.equal(r.stdout, 'kind: patch\n');
});

test('box-pins changed names each change to what the image runs, alone, and exits 3', () => {
  const cases = [
    ['gateway', { 'cloud/gateway.mjs': append('// kit-671 probe\n') }, ['cloud/gateway.mjs']],
    ['dockerfile', { 'cloud/Dockerfile': append('# kit-671 probe\n') }, ['cloud/Dockerfile']],
    ['hub-page', { 'docs/devteam/dashboard/hub.html': append('<!-- kit-671 probe -->\n') }, ['docs/devteam/dashboard/hub.html']],
    ['operator', { 'docs/devteam/process/operator.md': append('\nkit-671 probe.\n') }, ['docs/devteam/process/operator.md']],
    ['cmd-hub', { [SCRIPT]: after('function cmdHub() {\n', '  // kit-671 probe\n') }, [`${SCRIPT}#cmdHub`]],
    ['import', { [SCRIPT]: after("import crypto from 'node:crypto';\n", "import util from 'node:util';\n") }, [`${SCRIPT}#(rest)`]],
    ['home-at', { [SCRIPT]: after('const homeAt = (() => {\n', '  // kit-671 probe\n') }, [`${SCRIPT}#homeAt`]],
    ['proof', { [SCRIPT]: after('function dashboardProofProblem(proof, signed, now = Date.now()) {\n', '  // kit-671 probe\n') }, [`${SCRIPT}#dashboardProofProblem`]],
    ['reads', { [SCRIPT]: after("'sensor series', 'peek'", ", 'kit-671-probe'") }, [`${SCRIPT}#OPERATOR_READS`]],
    ['subcommanded', { [SCRIPT]: after("'sensor', 'settings', 'unread'", ", 'kit-671-probe'") }, [`${SCRIPT}#OPERATOR_SUBCOMMANDED`]],
    ['rename', (r) => execFileSync('git', ['mv', 'cloud/gateway.mjs', 'cloud/gw.mjs'], { cwd: r }), ['cloud/gateway.mjs', 'cloud/gw.mjs']],
    ['in-region', { [SCRIPT]: after('/* box start */\n', 'const kit671Probe = 1;\n') }, [`${SCRIPT}#box`]],
  ];
  for (const [name, edits, want] of cases) {
    onBranch(`minor-${name}`, edits);
    const r = changed(['--since', 'v9.1.0']);
    assert.equal(r.status, 3, `${name}: ${r.stderr}${r.stdout}`);
    assert.equal(r.stdout, `${want.map((w) => `image: ${w}\n`).join('')}kind: minor (${want.length} changes the image runs)\n`, name);
  }
});

test('box-pins changed reads the range --to names, not HEAD', () => {
  const a = onBranch('to-a', { 'cloud/gateway.mjs': append('// kit-671 probe\n') });
  const b = onBranch('to-b', (r) => execFileSync('git', ['checkout', 'v9.1.0', '--', 'cloud/gateway.mjs'], { cwd: r }), 'to-a');
  const ra = changed(['--since', 'v9.1.0', '--to', a]);
  assert.equal(ra.status, 3, ra.stderr);
  assert.equal(ra.stdout, 'image: cloud/gateway.mjs\nkind: minor (1 changes the image runs)\n');
  for (const args of [['--to', b], []]) {
    const r = changed(['--since', 'v9.1.0', ...args]);
    assert.equal(r.status, 0, `${args}: ${r.stderr}${r.stdout}`);
    assert.equal(r.stdout, 'kind: patch\n');
  }
});

test('box-pins changed exits 2, saying why on stderr and nothing on stdout, when it can\'t tell', () => {
  onBranch('cant-tell', { 'docs/devteam/dashboard/index.html': append('<!-- x -->\n') });
  for (const json of [[], ['--json']]) {
    const r = changed(['--since', 'v9.9.0', ...json]);
    assert.equal(r.status, 2, r.stderr);
    assert.equal(r.stdout, '');
    assert.match(r.stderr.split('\n')[0], /^devteam: .*--since/);
  }
  for (const args of [[], ['--since'], ['--since', 'v9.1.0', '--frob'], ['--since', 'v9.1.0', '--to'], ['--since', 'v9.1.0', 'extra'], ['--since', 'v9.1.0', 'v9.1.0']]) {
    const r = changed(args);
    assert.equal(r.status, 2, `${args.join(' ')}: ${r.stderr}`);
    assert.equal(r.stdout, '', args.join(' '));
    assert.match(r.stderr, /^devteam: /, args.join(' '));
  }
});

// keys in order, and each value's type; a change's part is a string or null
const shapeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? ['array'] : typeof v === 'object' ? Object.entries(v).map(([k, x]) => [k, shapeOf(x)]) : typeof v);
const render = (j) => `${j.changes.map((c) => `image: ${c.file}${c.part === null ? '' : `#${c.part}`}\n`).join('')}${j.kind === 'patch' ? 'kind: patch' : `kind: minor (${j.changes.length} changes the image runs)`}\n`;
const sortedChanges = (cs) => [...cs].sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.part === b.part ? 0 : a.part === null ? -1 : b.part === null ? 1 : a.part < b.part ? -1 : 1));

test('box-pins changed --json has the shape of image-changes@1\'s fixtures, and the text renders it', () => {
  const fixture = (f) => JSON.parse(fs.readFileSync(path.join(REPO, 'test/fixtures/image-changes', f), 'utf8'));
  const since = (changedKit(), cg(['rev-parse', 'v9.1.0^{commit}']).trim());
  const cases = [
    ['json-patch', { 'docs/devteam/dashboard/index.html': append('<!-- x -->\n') }, 'patch.json', 0],
    ['json-minor', { 'cloud/gateway.mjs': append('// x\n'), [SCRIPT]: (t) => after("import crypto from 'node:crypto';\n", "import util from 'node:util';\n")(after('function cmdHub() {\n', '  // x\n')(t)) }, 'minor.json', 3],
  ];
  for (const [name, edits, fx, code] of cases) {
    const head = onBranch(name, edits);
    const j = changed(['--since', 'v9.1.0', '--json']);
    assert.equal(j.status, code, j.stderr);
    const got = JSON.parse(j.stdout);
    const want = fixture(fx);
    assert.deepEqual(shapeOf(got), shapeOf(want), name);
    for (const c of got.changes) {
      assert.deepEqual(Object.keys(c), ['file', 'part']);
      assert.equal(typeof c.file, 'string');
      assert.ok(c.part === null || typeof c.part === 'string');
    }
    assert.equal(got.v, 1);
    assert.equal(got.since, since);
    assert.equal(got.to, head);
    assert.equal(got.kind, code === 0 ? 'patch' : 'minor');
    assert.equal(got.changes.length === 0, got.kind === 'patch');
    assert.deepEqual(got.changes, sortedChanges(got.changes));
    const t = changed(['--since', 'v9.1.0']);
    assert.equal(t.status, code);
    assert.equal(t.stdout, render(got), name);
  }
  assert.deepEqual(JSON.parse(changed(['--since', 'v9.1.0', '--json']).stdout).changes, [
    { file: 'cloud/gateway.mjs', part: null }, { file: SCRIPT, part: '(rest)' }, { file: SCRIPT, part: 'cmdHub' },
  ]);
});

// IMAGE_RUNS and the kit's parts and glob readers, read from this checkout's script
const kitSource = fs.readFileSync(path.join(REPO, SCRIPT), 'utf8');
const regionOf = (name) => kitSource.slice(kitSource.indexOf(`/* ${name} start */`), kitSource.indexOf(`/* ${name} end */`));
const partsLib = new Function(`${regionOf('parts')}; return { fileParts, partLeaves };`)();
const globsLib = new Function(`${regionOf('globs')}; return { pathMatches };`)();
function imageRunsFromSource() {
  const at = kitSource.indexOf('\nconst IMAGE_RUNS = {');
  assert.ok(at !== -1, 'IMAGE_RUNS is declared');
  const end = kitSource.indexOf('\n};\n', at);
  return { list: new Function(`return ${kitSource.slice(at + '\nconst IMAGE_RUNS = '.length, end + 2)}`)(), at };
}

test('IMAGE_RUNS lists every machineWide handler, the guards, and only parts and files that exist', () => {
  const { list } = imageRunsFromSource();
  assert.equal(list.script, SCRIPT);
  const listed = new Set(list.parts);
  const wide = kitSource.split('\n').find((l) => /^\s*const machineWide = /.test(l));
  assert.ok(wide, 'the machineWide line');
  const commands = [...new Set([...[...wide.matchAll(/\[([^\]]*)\]\.includes\(command\)/g)].flatMap((m) => [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1])), ...[...wide.matchAll(/command === '([^']+)'/g)].map((m) => m[1])])];
  assert.deepEqual(commands.sort(), ['box-pins', 'hub', 'machine', 'operator-thread', 'recover']);
  const table = kitSource.slice(kitSource.indexOf('\nconst COMMANDS = {'), kitSource.indexOf('\n};\n', kitSource.indexOf('\nconst COMMANDS = {')));
  const handlers = commands.map((c) => { const m = new RegExp(`(?:^|[\\s,{])(?:'${c}'|${c.includes('-') ? `'${c}'` : c}): (\\w+)`).exec(table); assert.ok(m, `COMMANDS has ${c}`); return m[1]; });
  assert.deepEqual(handlers.sort(), ['cmdBoxPins', 'cmdHub', 'cmdMachine', 'cmdOperatorThread', 'cmdRecover']);
  for (const h of handlers) assert.ok(listed.has(h), `${h} is in IMAGE_RUNS`);
  const P = partsLib.fileParts(kitSource, SCRIPT);
  const guardLine = P.lines.findIndex((l) => l.startsWith('if (process.env.DEVTEAM_RUN && command')) + 1;
  assert.ok(guardLine > 0, 'the DEVTEAM_RUN guard');
  const guardPart = P.owner[guardLine].slice(2).replace(/#\d+$/, "").split("/").pop();
  assert.ok(listed.has(guardPart), `the guard's part ${guardPart} is in IMAGE_RUNS`);
  assert.ok(listed.has('homeAt'));
  for (const n of list.parts) assert.ok(P.places.has(n), `${n} is a part of ${SCRIPT}`);
  assert.equal(new Set(list.parts).size, list.parts.length, 'no part twice');
  const tracked = execFileSync('git', ['ls-files'], { cwd: REPO, encoding: 'utf8' }).split('\n').filter(Boolean);
  for (const g of list.files) assert.ok(tracked.some((f) => globsLib.pathMatches(g, f)), `${g} matches a tracked file`);
});

test('IMAGE_RUNS: the three kinds under the rule, with the parts the design names; usage names changed', () => {
  const { list, at } = imageRunsFromSource();
  assert.deepEqual(list.files, ['cloud/**', 'docs/devteam/dashboard/hub.html', 'docs/devteam/process/operator.md']);
  const named = ['gatewaySigned', 'termSigned', 'dashboardProofProblem', 'paneSigned', 'ownerSettingSigned', 'paneProofProblem', 'ownerSettingProofProblem', 'OPERATOR_READS', 'OPERATOR_SUBCOMMANDED',
    'homeAt', 'realPathMade', 'startHub', 'HUB_ACTIONS', 'probeHello', 'recoverMachine', 'projectKit', 'box', 'box-memory', 'readPins', 'imageHub'];
  for (const n of named) assert.ok(list.parts.includes(n), `${n} is listed`);
  const before = kitSource.slice(0, at).split('\n');
  let i = before.length - 1;
  const comment = [];
  while (i >= 0 && /^\/\//.test(before[i])) comment.unshift(before[i--]);
  const rule = comment.map((l) => l.replace(/^\/\/ ?/, '')).join(' ');
  assert.match(rule, /box image runs[\s\S]*relies on/);
  assert.match(rule, /new image command adds its parts here/);
  assert.match(rule, /bumps a crossing's version is a minor/);
  assert.match(kitSource, /^const BOX_PINS_USAGE = '[^\n]*changed --since <ref> \[--to <ref>\] \[--smoke\] \[--json\]/m);
});
