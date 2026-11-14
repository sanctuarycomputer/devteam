#!/usr/bin/env node
// kit-47's static check of the box image's pins (a ticket record, not a product file):
//   node docs/devteam-dev/tickets/kit-47-dockerfile-pin-args/verify-pins.mjs cloud/Dockerfile
// Exit 0, or exit 1 with one line per failure. The rules are plan.md T1 step 1.
import { readFileSync } from 'node:fs';

const file = process.argv[2];
if (!file) { console.error('usage: verify-pins.mjs <dockerfile>'); process.exit(2); }
const text = readFileSync(file, 'utf8');
const lines = text.split('\n');
const fails = [];
const fail = (m) => fails.push(m);

// [tool, binary, version, sum x86_64, sum aarch64, arch x86_64, arch aarch64], in the spec's order
const TOOLS = [
  ['TTYD', true, '1.7.7', '8a217c968aba172e0dbf3f34447218dc015bc4d5e59bf51db2f2cd12b7be4f55', 'b38acadd89d1d396a0f5649aa52c539edbad07f4bc7348b27b4f4b7219dd4165', null, null],
  ['GH', true, '2.104.0', '98cb101ad87dbbd3f6b2f2bfcbd43197ccd07643140121d8a9cfaa91eadbc24e', 'cb34cefc6f4e77b90731374a2b737516bb8f3033c6ca46aa949e5344f68069e3', 'amd64', 'arm64'],
  ['MISE', true, 'v2026.10.17', 'fe6dd17e68e09682b31d2e7bb7bb755d22636ac1af5d94621e300f2ca9e9fe8a', 'e90904144ba4377c5fbe385f429830282c68f3b4f9c690bf6c5a2ae9b74a809b', 'x64', 'arm64'],
  ['UV', true, '0.13.7', 'c5221ff41b7892bfc223543883600125f6a47fe845093e0f5bdff4f359196d83', '71279f8d3c67241e807b9d8db872d1bf541579fb9f08b7d1eb1682196d1e57dc', null, null],
  ['CLAUDE_SWAP', false, '1.0.0'],
  ['CLAUDE_CODE', false, '2.1.307'],
];
const RELEASE = 'v0.52.0';
const BOX_TOOLS = 'DEVTEAM_BOX_TOOLS="claude-code=$CLAUDE_CODE_VERSION claude-swap=$CLAUDE_SWAP_VERSION gh=$GH_VERSION ttyd=$TTYD_VERSION mise=$MISE_VERSION uv=$UV_VERSION"';

// Instructions, with `\` continuations joined and heredoc bodies kept out (their shell isn't the Dockerfile's).
const instructions = [];
const heredoc = new Set();
for (let i = 0; i < lines.length; i++) {
  const l = lines[i];
  if (/^\s*(#|$)/.test(l)) continue;
  const start = i;
  let body = l;
  while (/\\$/.test(lines[i]) && i + 1 < lines.length) {
    i++;
    if (/^\s*#/.test(lines[i])) continue;
    body += '\n' + lines[i];
  }
  const m = body.match(/<<-?'?(\w+)'?/);
  if (m && /^(COPY|RUN)\b/.test(body)) {
    while (i + 1 < lines.length && lines[i + 1] !== m[1]) heredoc.add(++i);
    heredoc.add(++i);
  }
  instructions.push({ start, end: i, kw: body.split(/\s/)[0], body });
}
const outside = (i) => !heredoc.has(i);

// ARG lines, raw
const args = new Map();
lines.forEach((l, i) => {
  const m = outside(i) && l.match(/^ARG (\w+)=(.*)$/);
  if (!m) return;
  if (args.has(m[1])) fail(`ARG ${m[1]} declared twice`);
  args.set(m[1], { value: m[2], line: i });
  if (/\\$/.test(l)) fail(`line ${i + 1}: ARG ${m[1]} continues onto the next line`);
  if (/\s|["']/.test(m[2])) fail(`line ${i + 1}: ARG ${m[1]}'s value is quoted or has a space`);
});

const count = (s) => text.split(s).length - 1;
const pinNames = [];
for (const [tool, binary, version, x86, arm] of TOOLS) {
  const want = [[`${tool}_VERSION`, version]];
  if (binary) want.push([`${tool}_SHA256_X86_64`, x86], [`${tool}_SHA256_AARCH64`, arm]);
  for (const [name, value] of want) {
    pinNames.push(name);
    const a = args.get(name);
    if (!a) { fail(`no ARG ${name}`); continue; }
    if (a.value !== value) fail(`ARG ${name}=${a.value}, want ${value}`);
    if (count(value) !== 1) fail(`${value} (${name}) appears ${count(value)} times, want once, on its ARG line`);
    if (name.includes('_SHA256_') && !/^[0-9a-f]{64}$/.test(a.value)) fail(`ARG ${name} is not 64 lowercase hex`);
  }
}

// gh's apt source is gone, and the hub's ENV is kit-49's
for (const s of ['cli.github.com', 'githubcli', 'DEVTEAM_IMAGE_HUB']) if (text.includes(s)) fail(`${s} is still in the file`);
for (const ins of instructions) if (/apt-get install/.test(ins.body) && /\sgh(\s|$)/.test(ins.body)) fail(`line ${ins.start + 1}: apt still installs gh`);

// every pin reference names a declared ARG: a name ending _VERSION or holding _SHA256_, or one that
// starts with a tool's name (so a typo like $GH_VERSOIN, which would download nothing, is caught)
const prefixes = [...TOOLS.map((t) => `${t[0]}_`), 'DEVTEAM_RELEASE'];
for (const ins of instructions) {
  for (const m of ins.body.matchAll(/\$\{?(\w+)\}?/g)) {
    const n = m[1];
    const pinLike = n.endsWith('_VERSION') || n.includes('_SHA256_') || prefixes.some((p) => n.startsWith(p));
    if (pinLike && !args.has(n)) fail(`line ${ins.start + 1}: $${n} is not a declared ARG`);
  }
}

// each tool's block: a comment, then its ARGs on consecutive lines, then its RUN, which uses them all
const runOf = new Map();
let prevRun = -1;
for (const [tool, binary, , , , archX, archA] of TOOLS) {
  const v = args.get(`${tool}_VERSION`);
  if (!v) continue;
  const names = binary ? [`${tool}_VERSION`, `${tool}_SHA256_X86_64`, `${tool}_SHA256_AARCH64`] : [`${tool}_VERSION`];
  names.forEach((n, k) => {
    if (!new RegExp(`^ARG ${n}=`).test(lines[v.line + k] || '')) fail(`line ${v.line + k + 1}: want ARG ${n} here, right after the line above`);
  });
  const runLine = v.line + names.length;
  if (!/^RUN /.test(lines[runLine] || '')) fail(`line ${runLine + 1}: want ${tool}'s RUN right after its ARGs`);
  const above = lines[v.line - 1] || '';
  if (!/^#/.test(above)) fail(`line ${v.line}: want a comment right above ARG ${tool}_VERSION`);
  if (/^#\s*hold:/.test(above)) fail(`line ${v.line}: ${tool} is held, and nothing is held today`);
  if (v.line < prevRun) fail(`${tool}'s pins come before the previous tool's RUN (want ${TOOLS.map((t) => t[0]).join(', ')})`);
  const run = instructions.find((ins) => ins.start === runLine);
  if (run) {
    runOf.set(tool, run);
    prevRun = run.start;
    for (const n of names) if (!new RegExp(`\\$\\{?${n}\\b`).test(run.body)) fail(`${tool}'s RUN doesn't use $${n}`);
    if (binary && !/echo "\$sum  \S+" \| sha256sum -c -/.test(run.body)) fail(`${tool}'s RUN never checks its download with sha256sum -c`);
    if (binary) {
      for (const [arm, sumVar, arch] of [['x86_64', `${tool}_SHA256_X86_64`, archX], ['aarch64', `${tool}_SHA256_AARCH64`, archA]]) {
        const m = run.body.match(new RegExp(`${arm}\\)\\s*(?:arch=(\\w+);\\s*)?sum=\\$\\{?(\\w+)\\}?`));
        if (!m) { fail(`${tool}'s RUN has no ${arm}) arm setting sum=`); continue; }
        if (m[2] !== sumVar) fail(`${tool}'s ${arm}) arm reads $${m[2]}, want $${sumVar}`);
        if ((m[1] || null) !== arch) fail(`${tool}'s ${arm}) arm sets arch=${m[1] || '(none)'}, want ${arch || '(none)'}`);
      }
    }
  }
}

// order: apt layers, the tools, every COPY and RUN, then the stamp, its ENV, VOLUME /data
const pinLines = pinNames.map((n) => args.get(n)?.line).filter((x) => x !== undefined);
const firstPin = Math.min(...pinLines);
const lastApt = Math.max(-1, ...instructions.filter((ins) => /apt-get install/.test(ins.body)).map((ins) => ins.start));
if (lastApt > firstPin) fail(`an apt-get install (line ${lastApt + 1}) comes after the first pin ARG (line ${firstPin + 1})`);
const rel = args.get('DEVTEAM_RELEASE');
if (!rel) fail('no ARG DEVTEAM_RELEASE');
else {
  if (rel.value !== RELEASE) fail(`ARG DEVTEAM_RELEASE=${rel.value}, want ${RELEASE}`);
  for (const ins of instructions) if (/^(COPY|RUN)$/.test(ins.kw) && ins.start > rel.line) fail(`line ${ins.start + 1}: a ${ins.kw} after ARG DEVTEAM_RELEASE rebuilds on every stamp`);
  const k = instructions.findIndex((ins) => ins.start === rel.line);
  const env = instructions[k + 1], vol = instructions[k + 2];
  if (!env || env.kw !== 'ENV' || !env.body.includes('DEVTEAM_KIT_RELEASE=$DEVTEAM_RELEASE') || !env.body.includes(BOX_TOOLS)) fail(`want ENV DEVTEAM_KIT_RELEASE=$DEVTEAM_RELEASE and ${BOX_TOOLS} right after ARG DEVTEAM_RELEASE`);
  if (!vol || vol.body.trim() !== 'VOLUME /data') fail('want VOLUME /data right after the ENV');
}

// the doc comment above the first pin ARG: the comment lines above it, through blank lines
const doc = [];
for (let i = firstPin - 1; i >= 0 && /^(#|\s*$)/.test(lines[i]); i--) doc.unshift(lines[i]);
const docText = doc.join('\n');
for (const s of ['<TOOL>_VERSION', '_SHA256_X86_64', '_SHA256_AARCH64', '# hold: <reason>']) if (!docText.includes(s)) fail(`the comment above the pins doesn't mention ${s}`);

if (fails.length) { for (const f of fails) console.log(`verify-pins: ${f}`); process.exit(1); }
console.log(`verify-pins: ${file}: ${pinNames.length} pins, release ${RELEASE}, all checks pass`);
