/* imports start */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { KIT_UPSTREAM } from './state.mjs';
import { command } from './base.mjs';
import { die } from './base.mjs';
import { execFileSync } from 'node:child_process';
import { fileParts } from './graph.mjs';
import { flagStr } from './base.mjs';
import { flags } from './base.mjs';
import { git } from './base.mjs';
import { killGroup } from './sensors.mjs';
import { kitsOwnRepoAt } from './state.mjs';
import { out } from './base.mjs';
import { partLeaves } from './graph.mjs';
import { partsChanged } from './graph.mjs';
import { pathMatches } from './graph.mjs';
import { positional } from './base.mjs';
import { repo } from './repos.mjs';
import { repoRoot } from './state.mjs';
import { rest } from './base.mjs';
import { spawn } from 'node:child_process';
import { spawnSync } from 'node:child_process';
/* imports end */
// ===== box-pins: the box image's tool pins (cloud/Dockerfile) =====
// The pins are kit-47's ARGs, one per line just above the layer that installs the tool: <P>_VERSION,
// and for a downloaded binary <P>_SHA256_X86_64 and <P>_SHA256_AARCH64; a `# hold: <reason>` line
// right above a _VERSION ARG holds that tool. Late in the file, ARG DEVTEAM_RELEASE stamps the kit
// release and ENV DEVTEAM_BOX_TOOLS names every tool's version for the gateway and box-status. The
// table says where each tool comes from and how the image reports it (`installed`). Only the top
// package of the npm and PyPI tools is pinned: their dependencies resolve when the image is built.
export const bareVersion = (v) => String(v).replace(/^v/, '');
export const firstVersion = (o) => /(?<![\w.])v?(\d+(?:\.\d+)+)/.exec(o)?.[1] ?? null;
export const BOX_TOOLS = [
  { name: 'claude-code', prefix: 'CLAUDE_CODE', source: 'npm', pkg: '@anthropic-ai/claude-code', run: ['claude', '--version'], parse: firstVersion },
  // the image installs claude-swap with UV_TOOL_DIR set only inside its RUN, so `uv tool list` finds it only there
  { name: 'claude-swap', prefix: 'CLAUDE_SWAP', source: 'pypi', pkg: 'claude-swap', run: ['uv', 'tool', 'list'], env: { UV_TOOL_DIR: '/opt/uv/tools' }, parse: (o) => /^claude-swap\s+v?(\d+(?:\.\d+)+)/m.exec(o)?.[1] ?? null },
  // asset names as each tool's RUN downloads them, from the pin as the ARG holds it
  { name: 'gh', prefix: 'GH', source: 'github', repo: 'cli/cli', assets: { x86_64: (v) => `gh_${bareVersion(v)}_linux_amd64.tar.gz`, aarch64: (v) => `gh_${bareVersion(v)}_linux_arm64.tar.gz` }, run: ['gh', '--version'], parse: firstVersion },
  { name: 'ttyd', prefix: 'TTYD', source: 'github', repo: 'tsl0922/ttyd', assets: { x86_64: () => 'ttyd.x86_64', aarch64: () => 'ttyd.aarch64' }, run: ['ttyd', '--version'], parse: firstVersion },
  { name: 'mise', prefix: 'MISE', source: 'github', repo: 'jdx/mise', assets: { x86_64: (v) => `mise-${v}-linux-x64`, aarch64: (v) => `mise-${v}-linux-arm64` }, run: ['mise', '--version'], parse: firstVersion },
  { name: 'uv', prefix: 'UV', source: 'github', repo: 'astral-sh/uv', assets: { x86_64: () => 'uv-x86_64-unknown-linux-gnu.tar.gz', aarch64: () => 'uv-aarch64-unknown-linux-gnu.tar.gz' }, run: ['uv', '--version'], parse: firstVersion },
];
export const BOX_ARCHES = { x86_64: 'X86_64', aarch64: 'AARCH64' };
// what came off the network (or out of a file) goes to a terminal only when it is plainly a version
export const safe = (s) => (/^[\w.+-]{1,64}$/.test(String(s ?? '')) ? String(s) : '?');
export const versionParts = (v) => (/^v?\d+(\.\d+)+$/.test(String(v ?? '')) ? bareVersion(v).split('.').map(Number) : null);
export function newer(a, b) {
  const x = versionParts(a), y = versionParts(b);
  if (!x || !y) return false;
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  return false;
}
// a version in the form its pin has: a leading v exactly when the pin has one (gh's tag is v2.104.0, its pin 2.104.0)
export const pinForm = (v, pinned) => `${String(pinned).startsWith('v') ? 'v' : ''}${bareVersion(v)}`;
export const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const HOLD_LIKE = /^\s*#\s*hold\b/i;

// The Dockerfile's pins and every problem in how they are written (all but whether the stamp is a
// given release, which is the caller's): what verify reports, and what check and bump refuse on.
export function readPins(text) {
  const lines = text.split('\n');
  const problems = [];
  const argLines = (name) => lines.flatMap((l, i) => (l.startsWith(`ARG ${name}=`) ? [i] : []));
  const pinLines = new Set();
  const tools = BOX_TOOLS.map((tool) => {
    const p = { tool, version: null, versionLine: null, sums: {}, sumLines: {}, hold: null };
    const v = argLines(`${tool.prefix}_VERSION`);
    v.forEach((i) => pinLines.add(i));
    if (!v.length) problems.push(`${tool.name} has no ${tool.prefix}_VERSION`);
    else if (v.length > 1) problems.push(`${tool.name}'s ${tool.prefix}_VERSION is given ${v.length} times`);
    else {
      p.versionLine = v[0];
      p.version = lines[v[0]].slice(`ARG ${tool.prefix}_VERSION=`.length);
      if (!p.version) problems.push(`${tool.name}'s ${tool.prefix}_VERSION is empty`);
      // a pin that isn't a plain version can't be compared with upstream, so check and bump would never move it
      else if (!versionParts(p.version)) problems.push(`${tool.name}'s ${tool.prefix}_VERSION ${safe(p.version)} is not a plain version`);
    }
    for (const [arch, suffix] of Object.entries(tool.assets ? BOX_ARCHES : {})) {
      const name = `${tool.prefix}_SHA256_${suffix}`;
      const s = argLines(name);
      s.forEach((i) => pinLines.add(i));
      if (!s.length) problems.push(`${tool.name} has no ${name}`);
      else if (s.length > 1) problems.push(`${tool.name}'s ${name} is given ${s.length} times`);
      else {
        p.sumLines[arch] = s[0];
        p.sums[arch] = lines[s[0]].slice(`ARG ${name}=`.length);
        if (!/^[0-9a-f]{64}$/.test(p.sums[arch])) problems.push(`${name} is not 64 lowercase hex`);
      }
    }
    return p;
  });
  const rel = argLines('DEVTEAM_RELEASE');
  rel.forEach((i) => pinLines.add(i));
  let release = null, releaseLine = null;
  if (!rel.length) problems.push('no DEVTEAM_RELEASE');
  else if (rel.length > 1) problems.push(`DEVTEAM_RELEASE is given ${rel.length} times`);
  else {
    releaseLine = rel[0];
    release = lines[rel[0]].slice('ARG DEVTEAM_RELEASE='.length);
    if (!/^v\d+\.\d+\.\d+$/.test(release)) problems.push(`DEVTEAM_RELEASE ${safe(release)} is not vX.Y.Z`);
  }
  // holds: exactly `# hold: <reason>`, directly above a tool's _VERSION ARG; anything else that looks
  // like one is a problem, so a hold meant is never ignored and bump never moves a held tool
  lines.forEach((l, i) => {
    if (!HOLD_LIKE.test(l)) return;
    const m = /^# hold:(?: (.*))?$/.exec(l);
    if (!m) return problems.push(`line ${i + 1} looks like a hold but is not "# hold: <reason>"`);
    const p = tools.find((t) => t.versionLine === i + 1);
    if (!p) return problems.push(`the hold on line ${i + 1} is not directly above a _VERSION ARG`);
    if (!m[1]?.trim()) return problems.push(`${p.tool.name}'s hold has no reason`);
    p.hold = m[1].trim();
  });
  // no version or sum written anywhere but its ARG: a literal left in a RUN would not follow a bump
  // the text found, with a little of the line around it, however deep in a long RUN it sits
  const around = (l, m) => l.slice(Math.max(0, m.index - 24), m.index + m[0].length + 24).trim().replace(/[^\x20-\x7e]/g, '?');
  const strays = (re, say) => lines.forEach((l, i) => { const m = !pinLines.has(i) && !HOLD_LIKE.test(l) && re.exec(l); if (m) problems.push(`${say} is written outside its ARG (line ${i + 1}: ${around(l, m)})`); });
  for (const p of tools) {
    if (p.version) strays(new RegExp(`(?<![\\d.])${escapeRe(bareVersion(p.version))}(?!\\.?\\d)`), `${p.tool.name}'s version ${safe(p.version)}`);
    for (const [arch, sum] of Object.entries(p.sums)) if (sum) strays(new RegExp(`(?<![0-9a-fA-F])${escapeRe(sum)}(?![0-9a-fA-F])`), `${p.tool.name}'s ${p.tool.prefix}_SHA256_${BOX_ARCHES[arch]} sum`);
  }
  // the ENV the gateway, box-status and `installed` read: exactly every tool's pin, each once
  const env = lines.flatMap((l) => { const m = /^\s*(?:ENV\s+)?DEVTEAM_BOX_TOOLS="([^"]*)"/.exec(l); return m ? [m[1]] : []; });
  if (!env.length) problems.push('no DEVTEAM_BOX_TOOLS');
  else if (env.length > 1) problems.push(`DEVTEAM_BOX_TOOLS is given ${env.length} times`);
  else {
    const pairs = env[0].split(/\s+/).filter(Boolean);
    for (const { tool } of tools) {
      const want = `${tool.name}=$${tool.prefix}_VERSION`;
      const n = pairs.filter((x) => x === want).length;
      if (n !== 1) problems.push(n ? `DEVTEAM_BOX_TOOLS names ${want} ${n} times` : `DEVTEAM_BOX_TOOLS does not name ${want}`);
    }
    for (const x of pairs) if (!tools.some(({ tool }) => x === `${tool.name}=$${tool.prefix}_VERSION`)) problems.push(`DEVTEAM_BOX_TOOLS names ${/^[\w.+=$-]{1,80}$/.test(x) ? x : '?'}, which is no tool's`);
  }
  return { lines, tools, release, releaseLine, problems };
}
// The Dockerfile box-pins works on: --dockerfile, or the cwd checkout's cloud/Dockerfile (the kit's own).
export function pinsFile() {
  const file = path.resolve(flagStr('dockerfile') ?? path.join(repoRoot, 'cloud', 'Dockerfile'));
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) die(`box-pins: no cloud/Dockerfile at ${file} (box-pins works on the kit's own checkout, or --dockerfile <path>)`, 2);
  return { file, text: fs.readFileSync(file, 'utf8') };
}
export const releaseFlag = () => {
  const r = flagStr('release') ?? (flags.release === true ? '' : undefined);
  if (r !== undefined && !/^v\d+\.\d+\.\d+$/.test(r)) die(`box-pins: --release ${JSON.stringify(r)} is not vX.Y.Z\nusage: ${BOX_PINS_USAGE}`);
  return r;
};
// Each tool's latest release upstream: npm's latest dist-tag, PyPI's version, or the highest GitHub
// release that is neither a draft nor a prerelease (read from the list, so a backport published after
// a newer line is not taken for the latest). Throws an Error whose message is the why, in our words.
// GitHub is read anonymously, or with GH_TOKEN, which goes to the API only: never with a download.
export const pinsBase = (k, dflt) => (process.env[k] || dflt).replace(/\/+$/, '');
// one deadline for the answer and its body (DEVTEAM_PINS_TIMEOUT_MS only for tests)
export const timedOut = (e) => e?.name === 'TimeoutError' || e?.name === 'AbortError';
export const unreachable = (e) => new Error(`unreachable (${timedOut(e) ? 'timed out' : safe(e?.cause?.code ?? e?.cause?.errors?.[0]?.code ?? e?.name)})`);
export async function upstreamJson(url, headers = {}) {
  const signal = AbortSignal.timeout(Number(process.env.DEVTEAM_PINS_TIMEOUT_MS) || 15000);
  let res;
  try { res = await fetch(url, { headers: { 'user-agent': 'devteam-box-pins', ...headers }, signal }); } catch (e) { throw unreachable(e); }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  let body;
  try { body = await res.text(); } catch (e) { throw unreachable(e); }
  try { return JSON.parse(body); } catch { throw new Error('bad JSON'); }
}
export const notRelease = (v) => new Error(`not a release: ${safe(v)}`);
export async function latestOf(tool) {
  if (tool.source === 'npm') {
    const v = (await upstreamJson(`${pinsBase('DEVTEAM_PINS_NPM', 'https://registry.npmjs.org')}/${tool.pkg.replace('/', '%2f')}/latest`))?.version;
    if (!versionParts(v)) throw notRelease(v);
    return { version: v };
  }
  if (tool.source === 'pypi') {
    const v = (await upstreamJson(`${pinsBase('DEVTEAM_PINS_PYPI', 'https://pypi.org')}/pypi/${tool.pkg}/json`))?.info?.version;
    if (!versionParts(v)) throw notRelease(v);
    return { version: v };
  }
  const auth = process.env.GH_TOKEN ? { authorization: `Bearer ${process.env.GH_TOKEN}` } : {};
  const list = await upstreamJson(`${pinsBase('DEVTEAM_PINS_GITHUB', 'https://api.github.com')}/repos/${tool.repo}/releases?per_page=30`, { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', ...auth });
  if (!Array.isArray(list)) throw new Error('bad JSON');
  const best = list.filter((r) => r && !r.draft && !r.prerelease && versionParts(r.tag_name)).reduce((a, r) => (!a || newer(r.tag_name, a.tag_name) ? r : a), null);
  if (!best) throw new Error('no release');
  return { version: best.tag_name, release: best };
}
// Every tool against upstream, in table order: held (nothing asked), current, stale or unknown.
export const holdText = (r) => String(r).replace(/[^\x20-\x7e]/g, '?');
export function checkPins(pins) {
  return Promise.all(pins.tools.map(async ({ tool, version, hold }) => {
    const row = { name: tool.name, pinned: version };
    if (hold) return { ...row, status: 'held', reason: hold };
    try {
      const { version: latest } = await latestOf(tool);
      return newer(latest, version) ? { ...row, status: 'stale', latest: pinForm(latest, version) } : { ...row, status: 'current' };
    } catch (e) { return { ...row, status: 'unknown', why: e.message }; }
  }));
}
export const pinsCheckLine = (r) => `${r.name}: ${r.status === 'stale' ? `stale ${safe(r.pinned)} -> ${safe(r.latest)}` : r.status === 'held' ? `held ${holdText(r.reason)}` : r.status === 'unknown' ? `unknown ${r.why}` : `current ${safe(r.pinned)}`}`;
// A release asset's sha256, from its bytes: downloaded (GitHub redirects to its object store) with no
// auth header whatever the URL, and checked against the digest GitHub publishes for it when it does.
export async function assetSum(asset) {
  const url = String(asset.browser_download_url ?? '');
  if (!/^https?:\/\//.test(url)) throw new Error(`${safe(asset.name)} has no download URL`);
  const failed = (e) => new Error(`download of ${safe(asset.name)} failed (${timedOut(e) ? 'timed out' : safe(e?.cause?.code ?? e?.cause?.errors?.[0]?.code ?? e?.code ?? e?.name)})`);
  const signal = AbortSignal.timeout(Number(process.env.DEVTEAM_PINS_TIMEOUT_MS) || 120000);
  let res, bytes;
  try { res = await fetch(url, { headers: { 'user-agent': 'devteam-box-pins' }, redirect: 'follow', signal }); } catch (e) { throw failed(e); }
  if (!res.ok) throw new Error(`download of ${safe(asset.name)}: HTTP ${res.status}`);
  try { bytes = Buffer.from(await res.arrayBuffer()); } catch (e) { throw failed(e); }
  const sum = crypto.createHash('sha256').update(bytes).digest('hex');
  const d = typeof asset.digest === 'string' && asset.digest.startsWith('sha256:') ? asset.digest.slice(7) : null;
  if (d && d !== sum) throw new Error(`the digest GitHub publishes for ${safe(asset.name)} is not the sha256 of its download`);
  return sum;
}
// The Dockerfile with every unheld tool at its latest release (sums from its assets' bytes) and the
// stamp at release; only those ARG lines change. Throws `<tool>: <why>` on any upstream failure.
export async function bumpPins(pins, release) {
  const lines = [...pins.lines];
  const changes = [];
  const set = (i, name, from, to) => { if (from === to) return; lines[i] = `ARG ${name}=${to}`; changes.push({ arg: name, from, to }); };
  const moves = await Promise.all(pins.tools.map(async (p) => {
    if (p.hold) return null;
    try {
      const latest = await latestOf(p.tool);
      if (!newer(latest.version, p.version)) return null;
      const version = pinForm(latest.version, p.version);
      const sums = {};
      for (const [arch, nameOf] of Object.entries(p.tool.assets ?? {})) {
        const asset = (latest.release?.assets ?? []).find((a) => a?.name === nameOf(version));
        if (!asset) throw new Error(`no asset ${safe(nameOf(version))} in release ${safe(latest.version)}`);
        sums[arch] = await assetSum(asset);
      }
      return { p, version, sums };
    } catch (e) { throw new Error(`${p.tool.name}: ${e.message}`); }
  }));
  for (const m of moves.filter(Boolean)) {
    set(m.p.versionLine, `${m.p.tool.prefix}_VERSION`, m.p.version, m.version);
    for (const [arch, sum] of Object.entries(m.sums)) set(m.p.sumLines[arch], `${m.p.tool.prefix}_SHA256_${BOX_ARCHES[arch]}`, m.p.sums[arch], sum);
  }
  set(pins.releaseLine, 'DEVTEAM_RELEASE', pins.release, release);
  return { text: lines.join('\n'), changes, held: pins.tools.filter((p) => p.hold).map((p) => ({ name: p.tool.name, reason: p.hold })) };
}
// What the box image runs from its own copy of the kit, or relies on in a project's kit: a change to
// any of it since the minor the image was built at makes a release a minor (box-pins changed,
// test/contracts/image-changes.md). A new image command adds its parts here; a change that bumps a
// crossing's version is a minor whatever this list says. Anything not listed reaches the image at
// the next minor: staleness, never breakage, since the image is always a whole release. The file's
// rest (the imports, the Node check, the re-exec) always counts, so it isn't listed. The classifier's
// own parts are listed, so a change to the list is a minor.
export const IMAGE_RUNS = {
  // whole files, as globs relative to the kit repo
  files: ['cloud/**', 'docs/devteam/dashboard/hub.html', 'docs/devteam/process/operator.md'],
  // parts of this file, as fileParts names them
  script: 'docs/devteam/scripts/devteam.mjs',
  parts: [
    // the handlers the machineWide expression dispatches to
    'cmdHub', 'cmdMachine', 'cmdOperatorThread', 'cmdRecover', 'cmdBoxPins',
    // what they are built from that serves only the image: the hub
    'probeHello', 'HUB_BODY_MAX', 'hubTurnOk', 'HUB_ACTIONS', 'startHub', 'hubLogger', 'imageHub',
    // recover --machine (a project's own recover runs from that project's kit, never the image's;
    // its recoverOne is listed below as a crossing, since it writes supervisor-up.json)
    'siblingOf', 'isAdopted', 'machineProjects', 'projectKit', 'projectJson', 'kitHasRecover', 'notedPaneOf', 'tmuxName', 'readUpList', 'recoverMachine', 'LEGACY_RECOVER_MESSAGE', 'legacyRecover',
    // machine status, tell, alert, pane-state
    'PANE_DIALOG', 'PANE_LIMIT_LINE', 'plainText', 'paneState', 'machineUsage', 'machineSpeaker', 'machineAlert', 'TELL_ENTER_TRIES', 'enterLanded', 'TELL_PREFIX', 'machineTell',
    'notedIn', 'openQuestionsOf', 'machineQuestions', 'utcDay', 'lastReview', 'harvestOf', 'machineKnowledge', 'vParts', 'versionBefore', 'portAnswers', 'hubLine', 'boxStatusLine',
    'box-memory', 'box-health-contract', 'box-health-sampler', 'box-health-processes', 'box-health-disk', 'box-health-state', 'box-health-pool', 'box-health-claude', 'box-health-park', 'box-health-room', 'machineLine', 'statusLastFile', 'partlyHeld', 'SUPERVISOR_IDLE_MS', 'supervisorIdleMinutes', 'OPERATOR_PR_MARK', 'OPERATOR_PR_WAIT_MS', 'operatorPrsLine', 'machineStatus',
    // operator threads
    'OPERATOR_THREAD_ID', 'OPERATOR_SUBJECT_MAX', 'OPERATOR_STARTING_MS', 'box', 'gatewayProofProblem', 'proofBody', 'operatorSession', 'operatorDir', 'operatorThreadsFile', 'operatorId', 'OPERATOR_PARTS',
    'operatorSubjectProblem', 'operatorLines', 'operatorThreads', 'operatorAppend', 'operatorLocked', 'tmuxAsk', 'OPERATOR_PANE_FORMAT', 'OPERATOR_MARK', 'operatorPaneRows', 'operatorPanes',
    'operatorStartFile', 'operatorStartNote', 'operatorStarting', 'operatorNoted', 'isShellPane', 'operatorSeat', 'operatorState', 'OPERATOR_OPENING', 'operatorStart', 'typeLine', 'OPERATOR_HELD',
    'operatorHeld', 'deliverToOperator', 'operatorDataFrame', 'operatorThreadUsage',
    // the files their turns carry (kit-724): the naming rules and the quoting, the checks, and the hub's
    // routes (a dashboard's too, from the project's own kit)
    'UPLOAD_MAX', 'UPLOAD_TOTAL', 'UPLOAD_FREE', 'UPLOAD_KEEP_MS', 'UPLOAD_STALL_MS', 'UPLOAD_NAME', 'UPLOAD_PART', 'UPLOAD_FOLDER', 'safeUploadName', 'shellQuote', 'dropPaste',
    'uploadsOnBox', 'laptopUploadsDir', 'uploadsRoot', 'droppedFileProblem', 'FILES_MAX', 'FILES_PATH_MAX', 'attachedFiles', 'UPLOAD_IMAGES', 'uploadType', 'serveLaptopUpload',
    'UPLOAD_REQUEST_MS', 'UPLOAD_BODY_MS', 'uploadLimits', 'uploadRootOk', 'sweepLaptopUploads', 'uploadsReceiving', 'receiveLaptopUpload',
    // box-pins (installed runs in the image; verify, check and bump beside it)
    'firstVersion', 'BOX_TOOLS', 'BOX_ARCHES', 'pinForm', 'escapeRe', 'HOLD_LIKE', 'readPins', 'pinsFile', 'releaseFlag', 'pinsBase', 'timedOut', 'unreachable', 'upstreamJson', 'notRelease', 'latestOf', 'holdText',
    'checkPins', 'pinsCheckLine', 'assetSum', 'bumpPins', 'BOX_PINS_USAGE',
    // the guards that let the image's commands run outside a project: the machineWide expression,
    // and the DEVTEAM_RUN guard in realPathMade's part, which repeats that list (the helpers homeAt
    // also calls, KIT_VIEWS, kitsOwnRepoAt, projectIn and repoLinksIn, are shared, so not listed)
    'homeAt', 'realPathMade',
    // the project-side parts the image relies on (the crossings): the presses the gateway signs and
    // a dashboard verifies, and the operator's role guard
    'gatewaySigned', 'termSigned', 'dashboardProofProblem', 'paneSigned', 'ownerSettingSigned', 'paneProofProblem', 'ownerSettingProofProblem', 'OPERATOR_READS', 'OPERATOR_SUBCOMMANDED',
    // the dispatcher and the operator's role guard (region dispatch), and what they read: the command
    // and its arguments
    'dispatch', 'command', 'parseArgs',
    // what keeps a project's kit read-only for the operator: no facts saved, no usage cache written, no host claim at a prompt
    'factsSaveAtExit', 'usageCache', 'cmdPrompt',
    // what the boot script calls in a project's kit: settings --get tmux_session, and the run/supervisor-pane record it reads and removes
    // (its name, its writers, when it is written, and the mark beside it, which the image reads through markedPane)
    'cmdSettings', 'tmuxSession', 'supervisorPaneFile', 'supervisorPaneMark', 'recordSupervisorPane', 'rememberSupervisorPane', 'markUpgradedPane', 'markedPane',
    // run/supervisor-up.json, which the boot script reads ("up": false) to choose whom to restore, and its writers, recover's own included
    'SUPERVISOR_UP_FILE', 'writeSupervisorUp', 'noteSupervisorFromTick', 'noteSupervisorSelf', 'recoverOne',
    // the ~/.devteam/repos-<port> records a project's kit writes and recover --machine reads
    'registerOnMachine', 'machineRepoDir',
    // a dashboard leaves the machine's hub to the image (dashboardHub); the hub's port, which names the
    // repos records too, and the block of ports a project's dashboard binds in, which the hub scans
    'dashboardHub', 'HUB_PORT', 'PORT_BASE', 'PORT_RANGE',
    // the classifier itself, and the readers it is built from, so a change to the list is a minor
    'IMAGE_RUNS', 'imageChanges', 'parts', 'globs',
  ],
};
// box-pins changed: the changes, sorted (image-changes@1 §5), between two commits of the cwd's repo
// in what IMAGE_RUNS names: a file a glob matches (either side of a rename), a listed part of the
// script whose leaves changed (judged as partsChanged judges them), and the script's rest (its r:
// leaf only, never a region's rest). With smoke, also what the image's readers print of a project on
// each kit. Dies with 2 when it can't tell.
export async function imageChanges(since, to, { smoke = false } = {}) {
  const cant = (why) => die(`box-pins changed: ${why}`, 2);
  const found = new Map();
  const add = (file, part) => found.set(`${file}\0${part ?? ''}`, { file, part });
  // git with a deadline and no prompt (a partial clone fetches blobs; a credential prompt would wait)
  const git = (args) => { try { return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, stdio: ['ignore', 'pipe', 'ignore'], timeout: 120000, maxBuffer: 256 * 1024 * 1024 }).replace(/\n$/, ''); } catch { return null; } };
  const raw = git(['diff', '-z', '--name-status', '-M', since, to]);
  if (raw === null) cant(`git diff ${since} ${to} failed in ${repoRoot}`);
  const tokens = raw.split('\0');
  const paths = [];
  const S = IMAGE_RUNS.script;
  // which side has the script, from the diff's own letters (A added, D deleted, R/C old then new)
  let baseHas = null, headHas = null;
  for (let i = 0; i < tokens.length;) {
    const status = tokens[i++];
    if (!status) continue;
    const n = /^[RC]/.test(status) ? 2 : 1;
    const ps = tokens.slice(i, i + n);
    paths.push(...ps);
    i += n;
    if (n === 2) { if (ps[0] === S) { baseHas = true; headHas ??= status[0] === 'C'; } if (ps[1] === S) { headHas = true; baseHas ??= false; } }
    else if (ps[0] === S) { baseHas = status[0] !== 'A'; headHas = status[0] !== 'D'; }
  }
  for (const p of paths) if (IMAGE_RUNS.files.some((g) => pathMatches(g, p))) add(p, null);
  if (paths.includes(S)) {
    const textAt = (sha, has) => {
      if (!has) return '';
      const t = git(['show', `${sha}:${S}`]);
      if (t === null) cant(`git show ${sha}:${S} failed`);
      return t;
    };
    const base = textAt(since, baseHas), head = textAt(to, headHas);
    const B = fileParts(base, S), H = fileParts(head, S);
    const inBase = new Set(B.owner.slice(1));
    const leaves = partsChanged(base, head, S, []);
    if (leaves.includes('r:')) add(S, '(rest)');
    for (const name of IMAGE_RUNS.parts) {
      const cb = partLeaves(B, name), ch = partLeaves(H, name);
      if (leaves.some((k) => (inBase.has(k) ? cb : ch).has(k))) add(S, name);
    }
  }
  if (smoke) for (const command of await smokeDiffers()) add('(smoke)', command);
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  return [...found.values()].sort((a, b) => cmp(a.file, b.file) || (a.part === b.part ? 0 : a.part === null ? -1 : b.part === null ? 1 : cmp(a.part, b.part)));
  // --smoke (image-changes@1 §6): the image (a worktree of since) runs its readers of a project
  // against a fixture made by each kit, each fixture on a HOME of its own, in a temporary folder that
  // is removed on every exit (and git's record of that worktree with it, no other). A different exit, or a
  // different line of the fixture's own (after placeholders), is a change named for the command.
  // Each child is awaited, so a signal is handled between children (and kills the running one).
  async function smokeDiffers() {
    const tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-smoke-')));
    const tmuxDir = path.join(tmpDir, 'tmux'), imageDir = path.join(tmpDir, 'image');
    // the children's environment is an allowlist: no DEVTEAM_*, no TMUX, no GIT_DIR or its relatives
    // (a hook's), and none of the caller's tokens
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => /^(PATH|HOME|LANG|LANGUAGE|LC_\w+|TZ|TMPDIR|USER|LOGNAME|SHELL)$/.test(k)));
    let cleaned = false;
    let child = null;
    // each child leads a process group, so what it started (a fixture's kit under the image) goes too
    const killGroup = (c) => { try { process.kill(-c.pid, 'SIGKILL'); } catch { try { c.kill('SIGKILL'); } catch {} } };
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      if (child) killGroup(child);
      // nothing here starts a tmux server, but one left on this folder's own sockets is stopped
      let socks = [];
      try { socks = fs.readdirSync(tmuxDir).flatMap((d) => { try { return fs.readdirSync(path.join(tmuxDir, d)).map((s) => path.join(tmuxDir, d, s)); } catch { return []; } }); } catch {}
      for (const s of socks) spawnSync('tmux', ['-S', s, 'kill-server'], { env, stdio: 'ignore', timeout: 10000 });
      spawnSync('git', ['worktree', 'remove', '--force', '--force', imageDir], { cwd: repoRoot, env, stdio: 'ignore', timeout: 60000 });
      fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    };
    // a die (process.exit) cleans up too, and so does a signal: the running child is killed first
    const onSignal = () => { cleanup(); process.exit(2); };
    process.on('exit', cleanup);
    for (const s of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(s, onSignal);
    try {
      fs.mkdirSync(tmuxDir);
      const port = Number(spawnSync(process.execPath, ['-e', "const s = require('net').createServer(); s.listen(0, '127.0.0.1', () => { console.log(s.address().port); s.close(); })"], { encoding: 'utf8', timeout: 20000 }).stdout);
      if (!Number.isInteger(port) || port <= 0 || port === 4320) cant('--smoke: no free port for the fixtures\' hub');
      Object.assign(env, { DEVTEAM_HUB_PORT: String(port), TMUX_TMPDIR: tmuxDir, GIT_AUTHOR_NAME: 'devteam-smoke', GIT_COMMITTER_NAME: 'devteam-smoke', GIT_AUTHOR_EMAIL: 'devteam-smoke@example.invalid', GIT_COMMITTER_EMAIL: 'devteam-smoke@example.invalid' });
      // spawnSync's result, awaited: { status, signal, stdout (a Buffer when binary), stderr, error }
      const run = (cmd, args, { cwd, home, input, binary = false, childEnv } = {}) => new Promise((resolve) => {
        const c = spawn(cmd, args, { cwd, env: childEnv ?? { ...env, HOME: home ?? env.HOME }, stdio: [input ? 'pipe' : 'ignore', 'pipe', 'pipe'], detached: true });
        child = c;
        const so = [], se = [];
        let timedOut = false;
        const timer = setTimeout(() => { timedOut = true; killGroup(c); }, 120000);
        c.stdout.on('data', (d) => so.push(d));
        c.stderr.on('data', (d) => se.push(d));
        const done = (r) => { clearTimeout(timer); if (child === c) child = null; resolve(r); };
        c.on('error', (error) => done({ status: null, signal: null, stdout: binary ? Buffer.alloc(0) : '', stderr: '', error }));
        c.on('close', (status, signal) => { const out = Buffer.concat(so); done({ status, signal, stdout: binary ? out : out.toString('utf8'), stderr: Buffer.concat(se).toString('utf8'), error: timedOut ? Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }) : undefined }); });
        if (input) c.stdin.end(input);
      });
      const must = (r, what) => {
        // the line that says why: the kit's own (devteam: …), or an error's, else the first
        const lines = String(r.stderr ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
        const why = lines.find((l) => /^devteam: /.test(l)) ?? lines.find((l) => /^\w*Error\b/.test(l)) ?? lines[0];
        if (r.error || r.status !== 0) cant(`--smoke: ${what} failed (${r.error ? r.error.code ?? r.error.message : r.signal ?? `exit ${r.status}`})${why ? `: ${why.slice(0, 300)}` : ''}`);
        return r;
      };
      // the image and the fixtures' kits with -c core.useReplaceRefs=false (kit-778): a replace ref or core.useReplaceRefs any session can set would otherwise swap the tree checked out
      must(await run('git', ['-c', 'core.useReplaceRefs=false', 'worktree', 'add', '-q', '--detach', imageDir, since], { cwd: repoRoot }), `git worktree add of ${since}`);
      const kitIn = (root) => path.join(root, 'docs', 'devteam', 'scripts', 'devteam.mjs');
      const sides = [];
      for (const [side, sha] of [['since', since], ['to', to]]) {
        const parent = path.join(tmpDir, side), root = path.join(parent, 'smoke-fixture'), home = path.join(tmpDir, `home-${side}`);
        fs.mkdirSync(root, { recursive: true });
        fs.mkdirSync(home);
        must(await run('git', ['init', '-q', '-b', 'main'], { cwd: root, home }), `git init of the ${side} fixture`);
        const tar = must(await run('git', ['-c', 'core.useReplaceRefs=false', 'archive', '--format=tar', sha, 'docs/devteam'], { cwd: repoRoot, binary: true }), `git archive of ${sha}`);
        must(await run('tar', ['-x', '-C', root], { input: tar.stdout }), `unpacking the ${side} fixture's kit`);
        for (const d of ['project', 'run']) fs.rmSync(path.join(root, 'docs', 'devteam', d), { recursive: true, force: true });
        const own = async (args, what) => must(await run(process.execPath, [kitIn(root), ...args], { cwd: root, home }), `the ${side} fixture's ${what}`);
        await own(['init'], 'init');
        must(await run('git', ['add', '-A'], { cwd: root, home }), `git add in the ${side} fixture`);
        must(await run('git', ['commit', '-q', '-m', 'fixture'], { cwd: root, home }), `git commit in the ${side} fixture`);
        await own(['ask', '--question', 'Smoke question?', '--stake', '1', '--urgency', '1'], 'ask');
        await own(['knowledge', 'add', '--owner', '--kind', 'fact', '--statement', 'Smoke fact.'], 'knowledge add');
        fs.rmSync(path.join(root, 'docs', 'devteam', 'run', 'supervisor-up.json'), { force: true });
        sides.push({ side, parent, root, home, outs: {} });
      }
      const READERS = [['machine status', ['machine', 'status']], ['machine status --questions', ['machine', 'status', '--questions']], ['machine status --knowledge', ['machine', 'status', '--knowledge']], ['recover --machine --dry-run --force', ['recover', '--machine', '--dry-run', '--force']]];
      const trace = process.env.DEVTEAM_SMOKE_TRACE;
      const listing = (home) => { try { return fs.readdirSync(path.join(home, '.devteam')).sort(); } catch { return []; } };
      for (const s of sides) for (const [name, args] of READERS) {
        const childEnv = { ...env, HOME: s.home };
        const before = listing(childEnv.HOME);
        const r = await run(process.execPath, [kitIn(imageDir), ...args, '--in', s.parent], { cwd: imageDir, childEnv });
        if (r.error || r.status === null) cant(`--smoke: the image's ${name} against the ${s.side} fixture did not finish (${r.error?.code ?? r.signal})`);
        s.outs[name] = { exit: r.status, stdout: r.stdout };
        if (trace) fs.appendFileSync(trace, `${JSON.stringify({ fixture: s.side, command: name, home: childEnv.HOME, parent: s.parent, exit: r.status, stdout: r.stdout, home_devteam_before: before, home_devteam: listing(childEnv.HOME) })}\n`);
      }
      // only the fixture's own lines (§6.7), then the placeholders (§6.8, and tools= as §1 allows)
      const re = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const word = (s, extra = '') => new RegExp(`(?<![\\w${extra}-])${re(s)}(?![\\w${extra}-])`, 'g');
      const kept = (s, name) => {
        const lines = s.outs[name].stdout.split('\n');
        const mine = (l) => word(s.root).test(l) || word('smoke-fixture').test(l);
        const k = [];
        for (let i = 0; i < lines.length; i++) {
          if (!mine(lines[i])) continue;
          k.push(lines[i]);
          if (lines[i].endsWith(':')) while (i + 1 < lines.length && /^\s/.test(lines[i + 1])) k.push(lines[++i]);
        }
        const kit = /(?:^|\s)kit=(\S+)/.exec(s.outs['machine status'].stdout.split('\n').find((l) => word('smoke-fixture').test(l)) ?? '')?.[1];
        return k.map((l) => {
          let t = l.split(s.root).join('<path>').replace(word('smoke-fixture'), '<name>');
          if (kit && /^[A-Za-z0-9][\w.+-]*$/.test(kit)) t = t.replace(word(kit, '.+'), '<kit>');
          return t.replace(/(^|\s)tools=\S*/g, '$1tools=<tools>')
            .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?/g, '<time>')
            .replace(/\b[a-z]{1,2}-\d{8}-\d{9}-[a-z0-9][a-z0-9-]*/g, '<id>');
        });
      };
      const [a, b] = sides;
      const differs = [];
      for (const [name] of READERS) {
        const ka = kept(a, name), kb = kept(b, name);
        // the image's own kit prints nothing of its own fixture: the comparison would see nothing
        if (!ka.length) cant(`--smoke: ${name} printed no line of the --since fixture`);
        if (a.outs[name].exit === b.outs[name].exit && ka.join('\n') === kb.join('\n')) continue;
        differs.push(name);
        const i = ka.findIndex((l, j) => l !== kb[j]);
        const at = i === -1 ? ka.length : i;
        process.stderr.write(`devteam: --smoke: ${name} differs (exit ${a.outs[name].exit} on the --since fixture, ${b.outs[name].exit} on the --to one)\n  --since: ${ka[at] ?? '(no more lines)'}\n  --to:    ${kb[at] ?? '(no more lines)'}\n`);
      }
      return differs;
    } finally {
      cleanup();
      process.removeListener('exit', cleanup);
      for (const s of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.removeListener(s, onSignal);
    }
  }
}
export const BOX_PINS_USAGE = 'box-pins verify [--release vX.Y.Z] | check [--json] | bump --release vX.Y.Z [--dry-run] | changed --since <ref> [--to <ref>] [--smoke] [--json] | installed   (verify, check and bump take --dockerfile <path>; a patch, vX.Y.Z with Z > 0, is stamped vX.Y.0 and bump takes only a minor)';
// box-pins: verify, check and bump in the kit's own checkout (a KIT_VIEWS command; bump writes only
// the Dockerfile's pins), and installed inside the box image, from anywhere.
export async function cmdBoxPins() {
  const mode = positional[0];
  // the stamp a release needs (image-changes@1 §8): a patch (Z > 0) is stamped with the minor it
  // builds on, vX.Y.0; a minor or major with its own tag. tag is a vX.Y.Z releaseFlag let through.
  const stampFor = (tag) => { const [x, y, z] = tag.slice(1).split('.').map(Number); return z > 0 ? `v${x}.${y}.0` : tag; };
  if (mode === 'changed') {
    // image-changes@1: exit 0 patch, 3 minor, 2 can't tell (said on stderr, nothing on stdout)
    const usage = () => die(`usage: ${BOX_PINS_USAGE}`, 2);
    if (positional.length !== 1 || rest !== null || Object.keys(flags).some((k) => !['since', 'to', 'smoke', 'json'].includes(k))) usage();
    for (const k of ['since', 'to']) if (flags[k] !== undefined && (typeof flags[k] !== 'string' || !flags[k] || flags[k].startsWith('-'))) usage();
    for (const k of ['smoke', 'json']) if (flags[k] !== undefined && flags[k] !== true) usage();
    if (flags.since === undefined) usage();
    if (!kitsOwnRepoAt(repoRoot)) die(`box-pins changed: ${repoRoot} is not a checkout of the kit's own repo (${KIT_UPSTREAM}); run it there, at --to`, 2);
    const sha = (k, ref) => (() => { try { return execFileSync('git', ['rev-parse', '--verify', '-q', `${ref}^{commit}`], { cwd: repoRoot, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, stdio: ['ignore', 'pipe', 'ignore'], timeout: 60000 }).trim(); } catch { return null; } })() ?? die(`box-pins changed: --${k} ${ref} does not resolve to a commit`, 2);
    const since = sha('since', flags.since), to = sha('to', flags.to ?? 'HEAD');
    const changes = await imageChanges(since, to, { smoke: !!flags.smoke });
    const kind = changes.length ? 'minor' : 'patch';
    if (flags.json) out(JSON.stringify({ v: 1, since, to, kind, changes }, null, 2));
    else {
      for (const c of changes) out(`image: ${c.file}${c.part === null ? '' : `#${c.part}`}`);
      out(kind === 'patch' ? 'kind: patch' : `kind: minor (${changes.length} changes the image runs)`);
    }
    process.exitCode = changes.length ? 3 : 0;
    return;
  }
  if (mode === 'verify') {
    const want = releaseFlag();
    const { text } = pinsFile();
    const pins = readPins(text);
    const need = want === undefined ? undefined : stampFor(want);
    if (need !== undefined && pins.release !== null && pins.release !== need) pins.problems.push(need === want ? `DEVTEAM_RELEASE is ${safe(pins.release)}, not ${want}` : `DEVTEAM_RELEASE is ${safe(pins.release)}, not ${want}'s minor, ${need} (a patch is stamped with the minor it builds on)`);
    for (const p of pins.problems) out(`box-pins verify: ${p}`);
    if (pins.problems.length) { process.exitCode = 1; return; }
    out(`box-pins verify: ok, ${pins.tools.length} tools, release ${pins.release}`);
    return;
  }
  if (mode === 'check') {
    const pins = readPins(pinsFile().text);
    // a file whose pins can't be read is not checked: exit 2, as for no file
    if (pins.problems.length) {
      if (flags.json) out(JSON.stringify({ box_pins: 1, problems: pins.problems }, null, 2));
      else for (const p of pins.problems) out(`box-pins check: ${p}`);
      process.exitCode = 2;
      return;
    }
    const rows = await checkPins(pins);
    if (flags.json) out(JSON.stringify({ box_pins: 1, tools: rows }, null, 2));
    else for (const r of rows) out(pinsCheckLine(r));
    // 1: a pin is behind; 3: none is, but some upstream couldn't be asked; 0: all current or held
    process.exitCode = rows.some((r) => r.status === 'stale') ? 1 : rows.some((r) => r.status === 'unknown') ? 3 : 0;
    return;
  }
  if (mode === 'bump') {
    const release = releaseFlag();
    if (release === undefined) die(`box-pins bump needs --release vX.Y.Z\nusage: ${BOX_PINS_USAGE}`);
    if (stampFor(release) !== release) die(`box-pins bump: --release ${release} is a patch; only a minor gets a release-prep PR (a patch keeps its minor's stamp, ${stampFor(release)}); nothing written`);
    const { file, text } = pinsFile();
    const pins = readPins(text);
    if (pins.problems.length) {
      for (const p of pins.problems) out(`box-pins bump: ${p}`);
      die('box-pins bump: nothing written');
    }
    if (newer(pins.release, release)) die(`box-pins bump: --release ${release} is older than DEVTEAM_RELEASE ${pins.release}; nothing written`);
    let bumped;
    try { bumped = await bumpPins(pins, release); } catch (e) { die(`box-pins bump: ${e.message}; nothing written`); }
    // what is written must verify at that release, or nothing is
    const again = readPins(bumped.text);
    if (again.release !== release) again.problems.push(`DEVTEAM_RELEASE is ${safe(again.release)}, not ${release}`);
    if (again.problems.length) die(`box-pins bump: the result would not verify (${again.problems.join('; ')}); nothing written`);
    for (const c of bumped.changes) out(`${c.arg} ${safe(c.from)} -> ${safe(c.to)}`);
    for (const h of bumped.held) out(`held ${h.name}: ${holdText(h.reason)}`);
    if (flags['dry-run']) return out('--dry-run: nothing written');
    if (bumped.text === text) return out('unchanged');
    // beside the file (a symlink's target), so the rename is atomic; with its mode, whatever the umask
    const real = fs.realpathSync(file);
    const mode = fs.statSync(real).mode & 0o777;
    const tmpFile = `${real}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(tmpFile, bumped.text, { mode });
      fs.chmodSync(tmpFile, mode);
      fs.renameSync(tmpFile, real);
    } catch (e) { fs.rmSync(tmpFile, { force: true }); throw e; }
    out(`wrote ${file}`);
    return;
  }
  if (mode === 'installed') {
    // inside the image: what each tool says it is, asked at its path in the image, never through PATH
    // (on the box dev's PATH finds mise's own uv first), against the pins the image was built with
    const pinned = (process.env.DEVTEAM_BOX_TOOLS ?? '').trim();
    if (!pinned) die('box-pins installed: DEVTEAM_BOX_TOOLS is not set (not the box image?)', 2);
    const want = new Map(), unknown = [], named = new Map();
    for (const pair of pinned.split(/\s+/)) {
      const i = pair.indexOf('=');
      const name = i > 0 ? pair.slice(0, i) : pair;
      named.set(name, (named.get(name) ?? 0) + 1);
      if (BOX_TOOLS.some((t) => t.name === name)) want.set(name, pair.slice(i + 1)); else unknown.push(name);
    }
    // always a folder: a relative one is made absolute, so no tool is ever a bare name PATH resolves
    const bin = path.resolve(process.env.DEVTEAM_BOX_BIN || '/usr/local/bin');
    let bad = 0;
    const say = (line, ok = false) => { out(line); if (!ok) bad++; };
    for (const tool of BOX_TOOLS) {
      const pin = want.get(tool.name);
      if (pin === undefined) { say(`${tool.name}: not in DEVTEAM_BOX_TOOLS`); continue; }
      if (named.get(tool.name) > 1) { say(`${tool.name}: named ${named.get(tool.name)} times in DEVTEAM_BOX_TOOLS`); continue; }
      const [file, ...args] = tool.run;
      const r = spawnSync(path.join(bin, file), args, { encoding: 'utf8', timeout: 20000, env: { ...process.env, ...tool.env } });
      if (r.error || r.status !== 0) { say(`${tool.name}: did not run (${r.error ? safe(r.error.code) : r.signal ? safe(r.signal) : `exit ${r.status}`})`); continue; }
      const found = tool.parse(r.stdout);
      if (!found) { say(`${tool.name}: no version in its output`); continue; }
      const v = pinForm(found, pin);
      if (v === pin) say(`${tool.name}: ${safe(v)}`, true); else say(`${tool.name}: installed ${safe(v)}, pinned ${safe(pin)}`);
    }
    for (const n of unknown) say(`${safe(n)}: not a tool box-pins knows`);
    process.exitCode = bad ? 1 : 0;
    return;
  }
  die(`usage: ${BOX_PINS_USAGE}`);
}

