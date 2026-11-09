// Credentials kept out of settings and the log, shell-safe proposals, parseArgs, link-unreachable, help.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { kit, line, write, json, monoFixture } from './lib/kit.mjs';

test('credentials never enter settings or the log: userinfo refused, and remotes redacted wherever they are echoed', () => {
  const F = monoFixture('creds');
  const { old, ok, run, edit, g } = F;
  const SUP = { DEVTEAM_ROLE: 'supervisor' };
  try {
    assert.match(run(old, ['link', 'add', 'figma', '--kind', 'url', '--url', 'https://bob:hunter2@figma.example.com/x', '--title', 'D'], SUP).err, /links\.figma: .*credentials never go in settings/);
    assert.match(run(old, ['link', 'add', 'figma', '--kind', 'url', '--url', 'https://ghp_TOKEN@figma.example.com/x', '--title', 'D'], SUP).err, /credentials never go in settings/, 'a bare token is userinfo too');
    ok(old, ['link', 'add', 'figma', '--kind', 'url', '--url', 'https://figma.example.com/x', '--title', 'D'], SUP);
    assert.match(run(old, ['link', 'set', 'figma', 'url', 'https://u:p@figma.example.com/y'], SUP).err, /credentials never go in settings/);
    assert.match(run(old, ['observe-link', '--url', 'https://u:hunter2@notion.test/r', '--title', 'R'], SUP).err, /credentials/);
    g(['checkout', '-q', '--', 'docs/devteam/project/settings.md'], old);
    // a hand-written remote with a token is a validate error (on main: a working-tree repo link never counts)
    edit((j) => { j.links = { leak: { kind: 'repo', title: 'L', remote: 'https://x-access-token:ghp_SECRET1@github.com/me/leak.git' } }; });
    g(['commit', '-qam', 'leak'], old); g(['push', '-q', 'origin', 'main'], old);
    assert.match(run(old, ['validate']).out, /links\.leak: .*credentials never go in settings/);
    // a checkout whose origin carries a token: the mismatch is reported with the token stripped
    const co = path.join(F.base, 'console');
    g(['init', '-q', co], F.base);
    g(['remote', 'add', 'origin', 'https://x-access-token:ghp_SECRET123@github.com/me/fork-console.git'], co);
    edit((j) => { j.links = { console: { kind: 'repo', title: 'Console', remote: 'usbclub/console', path: co } }; });
    g(['commit', '-qam', 'links'], old); g(['push', '-q', 'origin', 'main'], old);
    ok(old, ['observe-metrics'], { ...SUP, DEVTEAM_URL_PROBE: '/usr/bin/true' });
    const f = json(ok(old, ['metrics', '--json'])).findings.find((x) => x.kind === 'link-unreachable');
    assert.match(f.detail, /is a checkout of https:\/\/github\.com\/me\/fork-console\.git, not usbclub\/console/);
    const logDir = path.join(old, 'docs/devteam/run/log');
    const all = fs.readdirSync(logDir).map((x) => fs.readFileSync(path.join(logDir, x), 'utf8')).join('');
    assert.match(all, /link-unreachable/);
    assert.doesNotMatch(all, /ghp_SECRET|hunter2|ghp_TOKEN/, 'no credential reaches the log');
    // a credentialed remote pushed straight to main, its password holding a
    // raw @, never reaches the log, a prompt, links or the dashboard data; nor does home's own origin
    const leak = 'https://x-access-token:ghp_AB@SECRET9@github.com/me/leak.git';
    edit((j) => { j.links = { leak: { kind: 'repo', title: 'Leak', remote: leak, for: ['all'] } }; });
    g(['commit', '-qam', 'leak 2'], old); g(['push', '-q', 'origin', 'main'], old);
    fs.rmSync(path.join(old, 'docs/devteam/run/link-probes.json'), { force: true });
    ok(old, ['observe-metrics'], { ...SUP, DEVTEAM_URL_PROBE: '/usr/bin/true' });
    ok(old, ['ticket', 'add', 'web-01-leak', '--json', JSON.stringify({ title: 'x', feature: 'chores', component: 'web', kind: 'chore', size: 'S', risk: 'normal', serves: [], depends_on: [], touches: ['web/**'], done_when: ['the web suite passes'], notes: 'n' })], SUP);
    ok(old, ['ask', '--question', 'Is the leak repo still used?', '--recommendation', 'yes', '--links', JSON.stringify([{ title: 'Leak', link: 'leak' }])], SUP);
    const secret = /ghp_AB|SECRET9/;
    const log2 = fs.readdirSync(logDir).map((x) => fs.readFileSync(path.join(logDir, x), 'utf8')).join('');
    assert.match(log2, /clone https:\/\/github\.com\/me\/leak\.git/, 'the fix hint names the remote, redacted');
    assert.doesNotMatch(log2, secret, 'the fix hint carries no credential');
    const prompt = ok(old, ['prompt', 'worker', 'web-01-leak']);
    assert.match(prompt, /\[link:leak\]/);
    assert.doesNotMatch(prompt, secret, 'prompts');
    assert.doesNotMatch(ok(old, ['metrics', '--json']), secret, 'metrics');
    assert.doesNotMatch(ok(old, ['questions']), secret, 'questions');
    assert.doesNotMatch(ok(old, ['dashboard-data']), secret, 'the dashboard data');
    const origin0 = g(['config', '--get', 'remote.origin.url'], old);
    g(['config', 'remote.origin.url', 'https://x-access-token:ghp_AB@SECRET9@github.com/me/home.git'], old);
    try {
      const l = ok(old, ['links']);
      assert.match(l, /home: this repo \(https:\/\/github\.com\/me\/home\.git\)/);
      assert.doesNotMatch(l, secret, 'links');
      assert.doesNotMatch(ok(old, ['links', '--json']), secret, 'links --json');
    } finally { g(['config', 'remote.origin.url', origin0], old); }
  } finally { F.done(); }
});

test('credentials in a query string, a fragment or an scp-style remote are refused, and redacted wherever one is echoed', () => {
  const F = monoFixture('creds-params');
  const { old, ok, run, edit, g } = F;
  const SUP = { DEVTEAM_ROLE: 'supervisor' };
  const secret = /SECRET|hunter2|AKIAEXAMPLE|deadbeef/;
  try {
    const presigned = 'https://bucket.s3.amazonaws.com/k.pdf?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAEXAMPLE%2F20261104&X-Amz-Date=20261104T000000Z&X-Amz-Expires=3600&X-Amz-SignedHeaders=host&X-Amz-Signature=deadbeef';
    for (const u of ['https://d.test/a?token=SECRET1', 'https://d.test/a?page=2&access_token=SECRET2', 'https://d.test/a#token=SECRET3', 'https://d.test/a?API_KEY=SECRET4', 'https://d.test/a?apikey=SECRET5', 'https://d.test/a?key=SECRET6', 'https://d.test/a?client_secret=SECRET7', 'https://d.test/a?sig=SECRET8', 'https://d.test/a?Signature=SECRET9', 'https://d.test/a?password=hunter2', 'https://d.test/a?passwd=hunter2', 'https://d.test/a?pw=hunter2', 'https://d.test/a?auth=SECRET0', 'https://d.test/a?secret=SECRET', presigned]) {
      const r = run(old, ['link', 'add', 'doc', '--kind', 'url', '--url', u, '--title', 'D'], SUP);
      assert.notEqual(r.status, 0, `${u} is refused`);
      assert.match(r.err, /links\.doc: its url carries credentials; credentials never go in settings/, u);
      assert.doesNotMatch(r.err, secret, `the refusal never echoes the secret: ${r.err}`);
      const o = run(old, ['observe-link', '--url', u, '--title', 'D'], SUP);
      assert.match(o.err, /--url carries credentials/, `observe-link: ${u}`);
      assert.doesNotMatch(o.err, secret);
      assert.match(run(old, ['ask', '--question', 'x?', '--links', JSON.stringify([{ title: 'y', url: u }])], SUP).err, /carries credentials/, `ask --links: ${u}`);
    }
    // a parameter that only starts like one of those names is not a credential
    ok(old, ['link', 'add', 'doc', '--kind', 'url', '--url', 'https://d.test/a?keyword=x&key_id=7&tokens=3#section-2', '--title', 'D'], SUP);
    g(['checkout', '-q', '--', 'docs/devteam/project/settings.md'], old);
    // scp-style user:password@host:path is a credential; user@host:path is the ssh user
    edit((j) => { j.links = { leak: { kind: 'repo', title: 'L', remote: 'bob:hunter2@github.com:me/leak.git' }, fine: { kind: 'repo', title: 'Fine', remote: 'git@github.com:me/fine.git' } }; });
    g(['commit', '-qam', 'scp leak'], old); g(['push', '-q', 'origin', 'main'], old);
    const v = run(old, ['validate']);
    assert.match(v.out, /links\.leak: its remote carries credentials/);
    assert.doesNotMatch(v.out, /links\.fine: .*credentials/);
    assert.doesNotMatch(v.out + v.err, secret, 'validate never echoes the password');
    edit((j) => { j.links = {}; });
    g(['commit', '-qam', 'no links'], old); g(['push', '-q', 'origin', 'main'], old);
    // echoed remotes: query parameters become name=REDACTED, an scp password goes
    const origin0 = g(['config', '--get', 'remote.origin.url'], old);
    try {
      g(['config', 'remote.origin.url', 'https://github.com/me/home.git?token=SECRETQ&ref=main#sig=SECRETF'], old);
      const l = ok(old, ['links']);
      assert.match(l, /https:\/\/github\.com\/me\/home\.git\?token=REDACTED&ref=main#sig=REDACTED/);
      assert.doesNotMatch(l, secret);
      g(['config', 'remote.origin.url', 'bob:hunter2@github.com:me/home.git'], old);
      const l2 = ok(old, ['links']);
      assert.match(l2, /bob@github\.com:me\/home\.git/);
      assert.doesNotMatch(l2, secret);
    } finally { g(['config', 'remote.origin.url', origin0], old); }
  } finally { F.done(); }
});

test('a credentialed url never reaches a question: orient redacts it in its proposal, ask --links refuses it', () => {
  const F = monoFixture('ask-creds');
  const { old, ok, run, g, edit } = F;
  const SUP = { DEVTEAM_ROLE: 'supervisor' };
  try {
    edit((j) => { j.links = { figma: { kind: 'url', title: 'Designs', url: 'https://figma.test/a' } }; });
    g(['commit', '-qam', 'figma'], old); g(['push', '-q', 'origin', 'main'], old);
    // observe-link refuses credentials, but observation lines are anyone's to write
    const logDir = path.join(old, 'docs/devteam/run/log');
    fs.mkdirSync(logDir, { recursive: true });
    const f = fs.readdirSync(logDir).find((x) => x.startsWith('supervisor-')) ?? 'supervisor-2026-11.jsonl';
    fs.appendFileSync(path.join(logDir, f), line({ id: 'o-20261104-120000000-supervisor', type: 'observation', op: 'new', at: '2026-11-04T12:00:00.000Z', by: 'supervisor', source: 'supervisor', subject: 'x', kind: 'link', detail: 'Designs', source_key: 'link:zz', link: { url: 'https://tok:ghp_ZZSECRET@other.test/d', title: 'Designs' } }));
    const props = json(ok(old, ['orient', '--json'], SUP)).filter((x) => x.proposal === 'conflict');
    assert.equal(props.length, 1, 'the rival title is a conflict proposal');
    assert.doesNotMatch(props[0].command, /ghp_ZZSECRET|tok:/, props[0].command);
    assert.match(props[0].command, /https:\/\/other\.test\/d/, 'the url is still named, redacted');
    // pasted as printed, or with the secret put back, ask refuses a credentialed inline link
    const r = run(old, ['ask', '--question', 'Which is the source of truth?', '--links', JSON.stringify([{ title: 'Designs', url: 'https://tok:ghp_ZZSECRET@other.test/d' }])], SUP);
    assert.notEqual(r.status, 0, r.out);
    assert.match(r.err, /--links: .*carries credentials; credentials never go in settings or the log/);
    assert.doesNotMatch(fs.readdirSync(logDir).map((x) => fs.readFileSync(path.join(logDir, x), 'utf8')).join('').split('\n').filter((l) => l.includes('"question"')).join('\n'), /ghp_ZZSECRET/, 'no question logged it');
  } finally { F.done(); }
});

test("orient's proposed commands are shell-safe: every value single-quoted, so pasting one runs nothing", () => {
  const F = monoFixture('orient-shq');
  const { old, ok, edit } = F;
  const SUP = { DEVTEAM_ROLE: 'supervisor' };
  try {
    edit((j) => { j.links = { figma: { kind: 'url', title: 'Designs', url: 'https://figma.test/a' }, console: { kind: 'repo', title: 'Console', remote: 'usbclub/console' } }; });
    const pwned = path.join(F.base, 'pwned');
    const evil = `see $(touch ${pwned}) and \`touch ${pwned}\` it's "quoted"`;
    const url = 'https://www.figma.com/design/K/N?node-id=0-1&t=abc';
    ok(old, ['observe-link', '--url', 'https://figma.test/a', '--title', 'Designs', '--notes', evil], { DEVTEAM_ROLE: 'worker', DEVTEAM_TICKET: 'web-01-x' });
    ok(old, ['observe-link', '--url', url, '--title', `Road $(touch ${pwned}) map`, '--notes', evil, '--for', 'component:web'], SUP);
    const props = json(ok(old, ['orient', '--json'])).filter((x) => x.proposal);
    assert.equal(props.length, 2);
    // the shell reads each command back into exactly the values it was built from, and runs nothing
    const argv = (cmd) => execFileSync('sh', ['-c', `set -- ${cmd}; for a in "$@"; do printf '%s\\0' "$a"; done`], { encoding: 'utf8' }).split('\0').slice(0, -1);
    const edit1 = argv(props.find((p) => p.proposal === 'edit').command);
    assert.deepEqual(edit1, ['link', 'set', 'figma', 'notes', evil]);
    const add = argv(props.find((p) => p.proposal === 'add').command);
    assert.equal(add[add.indexOf('--url') + 1], url, 'a URL with & and ? stays one argument');
    assert.equal(add[add.indexOf('--title') + 1], `Road $(touch ${pwned}) map`);
    assert.equal(add[add.indexOf('--notes') + 1], evil);
    assert.ok(!fs.existsSync(pwned), 'no command substitution ran');
    // a value that starts with -- survives the round trip: as --key=value for a flag, after a
    // bare -- for link set's value; run as printed, each lands exactly as observed
    ok(old, ['observe-link', '--url', 'https://figma.test/a', '--title', 'Designs', '--notes=--kind repo'], SUP);
    ok(old, ['observe-link', '--url', 'https://odd.test/x', '--title=--odd', '--notes=--kind repo'], SUP);
    ok(old, ['observe-link', '--path', 'docs/runbook.md', '--title=--runbook'], SUP);
    const dashed = json(ok(old, ['orient', '--json'])).filter((x) => x.proposal && x.command.includes('--kind repo') || x.command?.includes('--runbook'));
    const runAs = (cmd) => { for (const part of cmd.split(' && ')) ok(old, argv(part), SUP); };
    const e2 = dashed.find((p) => p.proposal === 'edit');
    assert.deepEqual(argv(e2.command).slice(-2), ['--', '--kind repo']);
    runAs(e2.command);
    assert.equal(json(ok(old, ['settings'])).links.figma.notes, '--kind repo');
    const a2 = dashed.find((p) => p.proposal === 'add');
    assert.ok(argv(a2.command).includes('--title=--odd') && argv(a2.command).includes('--notes=--kind repo'), a2.command);
    runAs(a2.command);
    const odd = Object.values(json(ok(old, ['settings'])).links).find((l) => l.url === 'https://odd.test/x');
    assert.deepEqual([odd?.title, odd?.notes], ['--odd', '--kind repo']);
    const p2 = dashed.find((p) => p.proposal === 'pointer');
    runAs(p2.command);
    assert.ok(json(ok(old, ['knowledge', '--json'])).some((k) => k.statement === '--runbook: docs/runbook.md'), 'the pointer statement lands whole');
  } finally { F.done(); }
});

test('parseArgs: --key=value carries a value that starts with --; every other form parses as before', () => {
  const src = fs.readFileSync(path.join(kit, 'scripts', 'devteam.mjs'), 'utf8');
  const i = src.indexOf('/* args start */'), j = src.indexOf('/* args end */');
  assert.ok(i >= 0 && j > i, 'parseArgs is marked in devteam.mjs');
  const parseArgs = vm.runInContext(`${src.slice(i, j)}\n;parseArgs`, vm.createContext({}));
  const p = (args) => JSON.parse(JSON.stringify(parseArgs(args)));
  // unchanged: positionals first, a flag takes every following non-flag token, a bare flag is true, -- ends parsing
  assert.deepEqual(p(['set', 'figma', '--for', 'a', 'b', '--json', '--title', 'T x', '--', 'cmd', '--x']), { flags: { for: ['a', 'b'], json: true, title: 'T x' }, positional: ['set', 'figma'], rest: ['cmd', '--x'] });
  assert.deepEqual(p(['--a', '-x', '--b']), { flags: { a: '-x', b: true }, positional: [], rest: null }, 'a single-dash value is a value');
  assert.deepEqual(p([]), { flags: {}, positional: [], rest: null });
  // new: --key=value, the value taken whole (it may start with -- or hold =), then any following values
  assert.deepEqual(p(['--notes=--kind repo', '--source', 'o-1']).flags, { notes: '--kind repo', source: 'o-1' });
  assert.deepEqual(p(['--q=a=b']).flags, { q: 'a=b' });
  assert.deepEqual(p(['--q=']).flags, { q: '' });
  assert.deepEqual(p(['--for=a', 'b']).flags, { for: ['a', 'b'] });
});

test('link-unreachable for a missing checkout or a failing URL (stubbed), and line-pressure from refusals', () => {
  const F = monoFixture('reach');
  const { old, ok, edit, g } = F;
  const SUP = { DEVTEAM_ROLE: 'supervisor' };
  const stub = path.join(F.base, 'probe.sh');
  write(stub, '#!/bin/sh\ncase "$1" in *gone*) echo 404 ;; *) echo 200 ;; esac\n');
  fs.chmodSync(stub, 0o755);
  try {
    edit((j) => { j.links = { console: { kind: 'repo', title: 'Console', remote: 'usbclub/console' }, gone: { kind: 'url', title: 'Gone', url: 'https://gone.test/x' }, fine: { kind: 'url', title: 'Fine', url: 'https://fine.test' }, private: { kind: 'url', title: 'P', url: 'https://gone.test/private', check: false } }; });
    g(['commit', '-qam', 'links'], old); g(['push', '-q', 'origin', 'main'], old);
    const run2 = (args) => { const r = spawnSync(process.execPath, [path.join(old, 'docs/devteam/scripts/devteam.mjs'), ...args], { cwd: old, env: { ...F.env(SUP), DEVTEAM_URL_PROBE: stub }, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout; };
    run2(['observe-metrics']);
    const fs_ = json(ok(old, ['metrics', '--json'])).findings.filter((f) => f.kind === 'link-unreachable');
    assert.deepEqual(fs_.map((f) => f.subject).sort(), ['console', 'gone']);
    assert.match(fs_.find((f) => f.subject === 'console').detail, /its checkout .*console is missing/);
    assert.match(fs_.find((f) => f.subject === 'gone').detail, /HEAD returned 404/);
    assert.equal(json(ok(old, ['log', '--type', 'observation', '--json'])).find((o) => o.kind === 'link-unreachable').severity, 3);
    assert.ok(fs.existsSync(path.join(old, 'docs/devteam/run/link-probes.json')));
    assert.doesNotMatch(json(ok(old, ['fleet', 'status', '--json', '--no-fetch'], SUP)).blockers.join('\n'), /files in run\/ the kit didn't make/, 'the probe file is a kit file (RUN_KNOWN)');
    // line-pressure counts tickets, not heads: one ticket refused three times is that ticket's
    F.lines(F.STD);
    for (const n of ['a', 'b', 'c']) ok(old, ['observe', '--subject', 'web', '--kind', 'footprint-refusal', '--detail', 'web-09-one refused', '--key', `footprint:web-09-one:${n}`, '--refs', 'web-09-one'], SUP);
    assert.ok(!json(ok(old, ['metrics', '--json'])).findings.some((f) => f.kind === 'line-pressure'), 'one ticket, three heads: no line pressure');
    // three tickets refused on one component in 14 days
    for (const n of ['01', '02']) ok(old, ['observe', '--subject', 'web', '--kind', 'footprint-refusal', '--detail', `web-${n}-x refused`, '--key', `footprint:web-${n}-x:${n}`], SUP);
    const lp = json(ok(old, ['metrics', '--json'])).findings.find((f) => f.kind === 'line-pressure');
    assert.equal(lp?.subject, 'web');
    assert.match(lp.detail, /footprint refusals on 3 tickets in 14 days/);
    // merge records the refusal itself, once per head
    ok(old, ['ticket', 'add', 'web-04-reach', '--json', JSON.stringify({ title: 'reach', feature: 'chores', component: 'web', kind: 'chore', size: 'S', risk: 'normal', serves: [], depends_on: [], touches: ['web/**', 'api/app.rb'], done_when: ['the web suite passes'], notes: 'n' })], SUP);
    const w = path.join(old, '.worktrees', 'web-04-reach');
    g(['worktree', 'add', '-q', '-b', 'ticket/web-04-reach', w, 'origin/main'], old);
    write(path.join(w, 'api/app.rb'), 'web edits api\n');
    g(['commit', '-qam', 'web-04-reach: work'], w);
    g(['push', '-q', 'origin', 'ticket/web-04-reach'], w);
    write(path.join(old, 'docs/devteam/run/pr/ticket/web-04-reach.md'), '# web-04-reach: work\n\n## One-way doors\n\nNone.\n');
    for (let i = 0; i < 2; i++) assert.match(F.run(old, ['merge', 'web-04-reach', '--dry-run'], SUP).out, /changes files outside the line of web/);
    const refused = json(ok(old, ['log', '--type', 'observation', '--json'])).filter((o) => o.kind === 'footprint-refusal' && (o.refs ?? []).includes('web-04-reach'));
    assert.deepEqual(refused.map((o) => o.subject), ['web'], 'one footprint-refusal per head, on the component');
  } finally { F.done(); }
});

test('help names the new commands', () => {
  const F = monoFixture('help');
  try {
    const h = F.ok(F.old, ['help']);
    for (const c of ['links [--json]', 'link add <id> --kind url', 'components check', 'observe-link', '{"title","link"}']) assert.ok(h.includes(c), c);
  } finally { F.done(); }
});
