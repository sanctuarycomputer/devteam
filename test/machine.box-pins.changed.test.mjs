// box-pins changed: what a range of the kit changes in what the box image runs (a patch or a minor),
// its --json, and IMAGE_RUNS read against the kit's own source.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { after, cg, changed, changedKit, onBranch, REPO, SCRIPT } from './lib/machine-fixture.mjs';

const append = (s) => (t) => `${t}${s}`;

// keys in order, and each value's type; a change's part is a string or null
const shapeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? ['array'] : typeof v === 'object' ? Object.entries(v).map(([k, x]) => [k, shapeOf(x)]) : typeof v);

const render = (j) => `${j.changes.map((c) => `image: ${c.file}${c.part === null ? '' : `#${c.part}`}\n`).join('')}${j.kind === 'patch' ? 'kind: patch' : `kind: minor (${j.changes.length} changes the image runs)`}\n`;

const sortedChanges = (cs) => [...cs].sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.part === b.part ? 0 : a.part === null ? -1 : b.part === null ? 1 : a.part < b.part ? -1 : 1));

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
  // parts only the --since side has (a declaration gone, from a listed region or a listed name), read backwards
  for (const [name, want] of [['in-region', `${SCRIPT}#box`], ['cmd-hub', `${SCRIPT}#cmdHub`]]) {
    cg(['checkout', '-q', `minor-${name}`]);
    const r = changed(['--since', `minor-${name}`, '--to', 'v9.1.0']);
    assert.equal(r.status, 3, `${name} backwards: ${r.stderr}${r.stdout}`);
    assert.equal(r.stdout, `image: ${want}\nkind: minor (1 changes the image runs)\n`);
  }
  // a region's own rest is that region's, never the file's: an unlisted region's is a patch, a listed one's its name
  onBranch('region-rest', { [SCRIPT]: after('/* term-server start */\n', 'void 0;\n') });
  const rr = changed(['--since', 'v9.1.0']);
  assert.equal(rr.status, 0, rr.stderr + rr.stdout);
  onBranch('box-rest', { [SCRIPT]: after('/* box start */\n', 'void 0;\n') });
  const br = changed(['--since', 'v9.1.0']);
  assert.equal(br.status, 3, br.stderr);
  assert.equal(br.stdout, `image: ${SCRIPT}#box\nkind: minor (1 changes the image runs)\n`);
});

test('box-pins changed reads a change to each part the image relies on as a minor (kit-306)', () => {
  const cases = [
    ['guard', "this is for the repo's supervisor or its owner`);", ' // kit-306 probe', 'dispatch'],
    ['facts', 'function factsSaveAtExit() {\n', '  // kit-306 probe\n', 'factsSaveAtExit'],
    ['usage', "save: () => { if (process.env.DEVTEAM_ROLE === 'operator') return;", ' /* kit-306 probe */', 'usageCache'],
    ['prompt', "const hc = process.env.DEVTEAM_ROLE === 'operator' ? {} : hostCheck({ start: true });", ' // kit-306 probe', 'cmdPrompt'],
    ['settings', "if (key === 'tmux_session') return out(tmuxSession());", ' // kit-306 probe', 'cmdSettings'],
    ['tmux-session', 'function tmuxSession({ save = false } = {}) {\n', '  // kit-306 probe\n', 'tmuxSession'],
    ['pane-file', "const supervisorPaneFile = (run) => path.join(run, 'supervisor-pane');", ' // kit-306 probe', 'supervisorPaneFile'],
    ['pane-mark', "const supervisorPaneMark = (run) => path.join(run, 'supervisor-pane-role');", ' // kit-306 probe', 'supervisorPaneMark'],
    ['pane-record', 'function recordSupervisorPane(run, pane) {\n', '  // kit-306 probe\n', 'recordSupervisorPane'],
    ['up-file', "const SUPERVISOR_UP_FILE = runPath('supervisor-up.json');", ' // kit-306 probe', 'SUPERVISOR_UP_FILE'],
    ['up-write', 'const writeSupervisorUp = (r) => { writeJson(SUPERVISOR_UP_FILE, { at: nowIso(), ...r }); registerOnMachine(); };', ' // kit-306 probe', 'writeSupervisorUp'],
    ['up-tick', 'function noteSupervisorFromTick() {\n', '  // kit-306 probe\n', 'noteSupervisorFromTick'],
    ['up-self', 'function noteSupervisorSelf() {\n', '  // kit-306 probe\n', 'noteSupervisorSelf'],
    ['recover-one', 'function recoverOne() {\n', '  // kit-306 probe\n', 'recoverOne'],
    ['list', 'const IMAGE_RUNS = {\n', '  // kit-306 probe\n', 'IMAGE_RUNS'],
    ['classifier', 'async function imageChanges(since, to, { smoke = false } = {}) {\n', '  // kit-306 probe\n', 'imageChanges'],
    ['parts-reader', 'function fileParts(text, file) {\n', '  // kit-306 probe\n', 'parts'],
    ['globs', 'const pathMatches = (entry, file) => globMatcher(entry)(file);', ' // kit-306 probe', 'globs'],
    ['register', 'function registerOnMachine() {\n', '  // kit-306 probe\n', 'registerOnMachine'],
    ['repo-dir', "const machineRepoDir = () => path.join(os.homedir(), '.devteam', `repos-${HUB_PORT}`);", ' // kit-306 probe', 'machineRepoDir'],
    // final-1b F1, F2, F4: the hub's port and the dashboards' block, every supervisor-pane writer and
    // its mark's reader, and what the operator guard reads (the command and its arguments)
    ['hub-port', 'const HUB_PORT = Number(process.env.DEVTEAM_HUB_PORT ?? 4320);', ' // kit-306 probe', 'HUB_PORT'],
    ['port-base', 'const PORT_BASE = Number(process.env.DEVTEAM_PORT_BASE ?? 4321);', ' // kit-306 probe', 'PORT_BASE'],
    ['port-range', 'const PORT_RANGE = Array.from({ length: 25 }, (_, i) => PORT_BASE + i);', ' // kit-306 probe', 'PORT_RANGE'],
    ['pane-remember', 'function rememberSupervisorPane() {\n', '  // kit-306 probe\n', 'rememberSupervisorPane'],
    ['pane-upgraded', 'function markUpgradedPane() {\n', '  // kit-306 probe\n', 'markUpgradedPane'],
    ['pane-marked', 'function markedPane(run) {\n', '  // kit-306 probe\n', 'markedPane'],
    ['args', 'function parseArgs(args) {\n', '  // kit-306 probe\n', 'parseArgs'],
    ['command', 'const command = argv.shift();', ' // kit-306 probe', 'command'],
  ].map(([name, anchor, add, part]) => [name, after(anchor, add), part]);
  // the check itself, not a comment: the image relies on it to leave the machine's hub to the image
  const hubCheck = 'if (imageHub() === HUB_PORT) {';
  cases.push(['dashboard-hub', (t) => { assert.equal(t.split(hubCheck).length, 2, `anchor ${hubCheck} once`); return t.replace(hubCheck, () => 'if (imageHub() === HUB_PORT && HUB_PORT > 0) {'); }, 'dashboardHub']);
  for (const [name, edit, part] of cases) {
    onBranch(`kit306-${name}`, { [SCRIPT]: edit });
    const r = changed(['--since', 'v9.1.0']);
    assert.equal(r.status, 3, `${name}: ${r.stderr}${r.stdout}`);
    assert.equal(r.stdout, `image: ${SCRIPT}#${part}\nkind: minor (1 changes the image runs)\n`, name);
  }
  // a part narrowed out of the list in the same change as a change to it: the list's own change is the minor (kit-672 F4)
  const narrowed = "'cmdHub', 'cmdMachine'";
  onBranch('kit306-narrowed', { [SCRIPT]: (t) => { assert.equal(t.split(narrowed).length, 2, `anchor ${narrowed} once`); return after('function cmdHub() {\n', '  // kit-306 probe\n')(t.replace(narrowed, () => "'cmdMachine'")); } });
  const n = changed(['--since', 'v9.1.0']);
  assert.equal(n.status, 3, `narrowed: ${n.stderr}${n.stdout}`);
  assert.equal(n.stdout, `image: ${SCRIPT}#IMAGE_RUNS\nkind: minor (1 changes the image runs)\n`, 'narrowed');
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

test('box-pins changed --json has the shape of image-changes@1\'s fixtures, and the text renders it', () => {
  const fixture = (f) => JSON.parse(fs.readFileSync(path.join(REPO, 'test/fixtures/image-changes', f), 'utf8'));
  const since = (changedKit(), cg(['rev-parse', 'v9.1.0^{commit}']).trim());
  const cases = [
    ['json-patch', { 'docs/devteam/dashboard/index.html': append('<!-- x -->\n') }, 'patch.json', 0],
    ['json-minor', { 'cloud/gateway.mjs': append('// x\n'), [SCRIPT]: (t) => after('const HUB_ACTIONS = {\n', '  // x\n')(after("import crypto from 'node:crypto';\n", "import util from 'node:util';\n")(after('function cmdHub() {\n', '  // x\n')(t))) }, 'minor.json', 3],
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
    { file: 'cloud/gateway.mjs', part: null }, { file: SCRIPT, part: '(rest)' }, { file: SCRIPT, part: 'HUB_ACTIONS' }, { file: SCRIPT, part: 'cmdHub' },
  ]);
  // outside the kit's own checkout it can't tell
  cg(['remote', 'set-url', 'origin', 'git@github.com:acme/not-the-kit.git']);
  try {
    const o = changed(['--since', 'v9.1.0']);
    assert.notEqual(o.status, 0); assert.notEqual(o.status, 3); assert.equal(o.stdout, '');
  } finally { cg(['remote', 'set-url', 'origin', 'git@github.com:sanctuarycomputer/devteam.git']); }
});

test('every devteam.mjs command cloud/Dockerfile runs is a command of the kit (kit-306)', () => {
  const dockerfile = fs.readFileSync(path.join(REPO, 'cloud', 'Dockerfile'), 'utf8');
  const lines = dockerfile.split('\n').filter((l) => !/^\s*#/.test(l));
  const ran = new Set();
  for (const m of lines.join('\n').matchAll(/scripts\/devteam\.mjs\s+([a-z][a-z-]*)/g)) ran.add(m[1]);
  assert.deepEqual([...ran].sort(), ['dashboard', 'hub', 'machine', 'operator-thread', 'recover', 'settings']);
  const table = kitSource.slice(kitSource.indexOf('/* commandGroups start */'), kitSource.indexOf('\n};\n', kitSource.indexOf('\nconst COMMANDS = {')));
  for (const c of ran) assert.ok(new RegExp(`(?:^|[\\s,{])(?:'${c}'|${c}):`).test(table), `COMMANDS has ${c}`);
});

test('IMAGE_RUNS lists every machineWide handler, the guards, and only parts and files that exist', () => {
  const { list } = imageRunsFromSource();
  assert.equal(list.script, SCRIPT);
  const listed = new Set(list.parts);
  const wide = kitSource.split('\n').find((l) => /^\s*const machineWide = /.test(l));
  assert.ok(wide, 'the machineWide line');
  const commands = [...new Set([...[...wide.matchAll(/\[([^\]]*)\]\.includes\(command\)/g)].flatMap((m) => [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1])), ...[...wide.matchAll(/command === '([^']+)'/g)].map((m) => m[1])])];
  assert.deepEqual(commands.sort(), ['box-pins', 'hub', 'machine', 'operator-thread', 'recover']);
  const table = kitSource.slice(kitSource.indexOf('/* commandGroups start */'), kitSource.indexOf('\n};\n', kitSource.indexOf('\nconst COMMANDS = {')));
  const handlers = commands.map((c) => { const m = new RegExp(`(?:^|[\\s,{])(?:'${c}'|${c.includes('-') ? `'${c}'` : c}): (\\w+)`).exec(table); assert.ok(m, `COMMANDS has ${c}`); return m[1]; });
  assert.deepEqual(handlers.sort(), ['cmdBoxPins', 'cmdHub', 'cmdMachine', 'cmdOperatorThread', 'cmdRecover']);
  for (const h of handlers) assert.ok(listed.has(h), `${h} is in IMAGE_RUNS`);
  const P = partsLib.fileParts(kitSource, SCRIPT);
  const guardLine = P.lines.findIndex((l) => l.startsWith('if (process.env.DEVTEAM_RUN && command')) + 1;
  assert.ok(guardLine > 0, 'the DEVTEAM_RUN guard');
  const guardPart = P.owner[guardLine].slice(2).replace(/#\d+$/, "").split("/").pop();
  assert.ok(listed.has(guardPart), `the guard's part ${guardPart} is in IMAGE_RUNS`);
  assert.ok(listed.has('homeAt'));
  // region dispatch: from the line after COMMANDS' closing }; to the file's last line, the operator's guard and the dispatch inside
  const disp = P.places.get('dispatch');
  assert.equal(disp?.length, 1, 'one dispatch region');
  const cmdEnd = P.places.get('COMMANDS')[0].to;
  assert.equal(P.lines[cmdEnd - 1], '};');
  assert.equal(P.lines[cmdEnd], '/* dispatch start */');
  for (const s of ["else if (process.env.DEVTEAM_ROLE === 'operator'", '  const r = COMMANDS[command]();']) {
    const line = P.lines.findIndex((l) => l.startsWith(s)) + 1;
    assert.ok(line > 0, s);
    assert.equal(P.owner[line], 'r:dispatch', s);
  }
  assert.equal(disp[0].to, P.n, 'the end marker is the last line');
  assert.ok(listed.has('dispatch'), 'dispatch is in IMAGE_RUNS');
  for (const n of list.parts) assert.ok(P.places.has(n), `${n} is a part of ${SCRIPT}`);
  assert.equal(new Set(list.parts).size, list.parts.length, 'no part twice');
  const tracked = execFileSync('git', ['ls-files'], { cwd: REPO, encoding: 'utf8' }).split('\n').filter(Boolean);
  for (const g of list.files) assert.ok(tracked.some((f) => globsLib.pathMatches(g, f)), `${g} matches a tracked file`);
});

test('IMAGE_RUNS: the three kinds under the rule, with the parts the design names; usage names changed', () => {
  const { list, at } = imageRunsFromSource();
  assert.deepEqual(list.files, ['cloud/**', 'docs/devteam/dashboard/hub.html', 'docs/devteam/process/operator.md']);
  const named = ['gatewaySigned', 'termSigned', 'dashboardProofProblem', 'paneSigned', 'ownerSettingSigned', 'paneProofProblem', 'ownerSettingProofProblem', 'OPERATOR_READS', 'OPERATOR_SUBCOMMANDED',
    'homeAt', 'realPathMade', 'startHub', 'HUB_ACTIONS', 'probeHello', 'recoverMachine', 'projectKit', 'box', 'box-memory', 'readPins', 'imageHub',
    'dispatch', 'factsSaveAtExit', 'usageCache', 'cmdPrompt', 'cmdSettings', 'tmuxSession', 'supervisorPaneFile', 'supervisorPaneMark', 'recordSupervisorPane', 'SUPERVISOR_UP_FILE', 'writeSupervisorUp',
    'noteSupervisorFromTick', 'noteSupervisorSelf', 'recoverOne', 'registerOnMachine', 'machineRepoDir', 'dashboardHub', 'HUB_PORT', 'PORT_BASE', 'PORT_RANGE', 'rememberSupervisorPane', 'markUpgradedPane', 'markedPane', 'parseArgs', 'command', 'IMAGE_RUNS', 'imageChanges', 'parts', 'globs'];
  for (const n of named) assert.ok(list.parts.includes(n), `${n} is listed`);
  // a dashboard is the project's own, its hub check the only crossing (dashboardHub); the table is no crossing, the dispatch after it is
  assert.ok(!list.parts.includes('cmdDashboard'));
  assert.ok(!list.parts.includes('COMMANDS'));
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
