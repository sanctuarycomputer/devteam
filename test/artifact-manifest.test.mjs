// The address `artifact manifest <slug>` gives a landed artifact once published (kit-281), and the
// supervisor's publishing rule that says the same. A box image that serves each project at a host
// of its own (project-hosts@1, cloud/gateway.mjs) sets DEVTEAM_PROJECT_HOSTS=1: there a public page
// is https://<project>.<box>/<slug>/, and public.<box> answers 421. An image from before it does
// not set it, and its gateway still serves public.<box>/<project>/<slug>/.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { kit, testDir, write } from './lib/kit.mjs';
import { runNode } from './lib/cli.mjs';

const ARTIFACTS_REL = 'docs/devteam/project/artifacts';
const HOSTS = JSON.parse(fs.readFileSync(path.join(testDir, 'fixtures', 'project-hosts.json'), 'utf8'));
// the names settings.md's project may have (devteam.mjs's PUBLIC_PROJECT); any other is refused before an address is given
const PUBLIC_PROJECT = /^[a-z0-9][a-z0-9._-]{0,62}$/;
const LINK_ID = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// A project with artifacts landed on main; no tmux, no hub, its own HOME, every DEVTEAM_* unset.
function project(t, slugs = ['landed-mock']) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-artifact-manifest-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const org = path.join(base, 'origin.git');
  const root = path.join(base, 'repo');
  const home = path.join(base, 'home');
  const g = (args, cwd = root) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const env = (extra = {}) => {
    const e = { ...process.env, HOME: home, CLAUDE_CONFIG_DIR: path.join(home, 'claude'), CODEX_HOME: path.join(home, 'codex') };
    for (const k of Object.keys(e)) if (k.startsWith('DEVTEAM_') || k === 'TMUX') delete e[k];
    return { ...e, ...extra };
  };
  const run = (args, extra) => { const r = runNode(path.join(root, 'docs/devteam/scripts/devteam.mjs'), args, { cwd: root, env: env(extra) }); return { status: r.status, out: r.stdout.trim(), err: r.stderr.trim() }; };
  fs.mkdirSync(home);
  g(['init', '-q', '--bare', '-b', 'main', org], base);
  fs.mkdirSync(root);
  g(['init', '-q', '-b', 'main']);
  for (const [k, v] of [['user.email', 't@t'], ['user.name', 't']]) g(['config', k, v]);
  g(['remote', 'add', 'origin', org]);
  fs.cpSync(kit, path.join(root, 'docs', 'devteam'), { recursive: true, filter: (p) => !/[\\/](project|run)([\\/]|$)/.test(p.slice(kit.length)) });
  const init = run(['init', '--name', 'demo']);
  assert.equal(init.status, 0, init.err || init.out);
  for (const s of slugs) {
    write(path.join(root, ARTIFACTS_REL, s, 'artifact.json'), JSON.stringify({ v: 1, title: 'Landed mock', summary: 'The card form', by: 'supervisor', for: [] }));
    write(path.join(root, ARTIFACTS_REL, s, 'index.html'), '<!doctype html><html><body><p>a page</p></body></html>');
  }
  g(['add', '-A']);
  g(['commit', '-qm', 'init']);
  g(['push', '-q', 'origin', 'main']);
  // the project's name is an owner setting, read from main: a rename lands there
  let now = 'demo';
  const rename = (name) => {
    const sf = path.join(root, 'docs/devteam/project/settings.md');
    const before = fs.readFileSync(sf, 'utf8');
    const after = before.replace(`"project": ${JSON.stringify(now)}`, `"project": ${JSON.stringify(name)}`);
    assert.notEqual(after, before, `settings.md's project becomes ${name}`);
    fs.writeFileSync(sf, after);
    g(['commit', '-qm', `rename to ${name}`, '--', 'docs/devteam/project/settings.md']);
    g(['push', '-q', 'origin', 'HEAD:main']);
    now = name;
  };
  const manifest = (slug, extra) => { const r = run(['artifact', 'manifest', slug], extra); assert.equal(r.status, 0, r.err || r.out); return r.out; };
  const json = (slug, extra) => { const r = run(['artifact', 'manifest', slug, '--json'], extra); assert.equal(r.status, 0, r.err || r.out); return JSON.parse(r.out); };
  return { run, rename, manifest, json };
}
const head = (project, slug) => `^${esc(project)}/${esc(slug)} at tree [0-9a-f]{12}: 2 files, \\d+ bytes; published, `;
const ON = { DEVTEAM_PROJECT_HOSTS: '1' };

test('C1 with DEVTEAM_PROJECT_HOSTS=1, artifact manifest gives https://<project>.<box>/<slug>/ and no public.<box> address', (t) => {
  const P = project(t);
  const said = P.manifest('landed-mock', ON);
  assert.match(said, new RegExp(`${head('demo', 'landed-mock')}it is https://demo\\.<box>/landed-mock/$`), said);
  assert.doesNotMatch(said, /public\.<box>/, said);
});

test('C2 without DEVTEAM_PROJECT_HOSTS=1 (an image before project hosts), artifact manifest gives public.<box>/<project>/<slug>/ as today', (t) => {
  const P = project(t);
  for (const v of [undefined, '', '0', 'true']) {
    const said = P.manifest('landed-mock', v === undefined ? {} : { DEVTEAM_PROJECT_HOSTS: v });
    assert.match(said, new RegExp(`${head('demo', 'landed-mock')}it is https://public\\.<box>/demo/landed-mock/$`), `DEVTEAM_PROJECT_HOSTS=${v}: ${said}`);
  }
});

test('C3 with DEVTEAM_PROJECT_HOSTS=1, a project name gets an address only where project-hosts@1 gives it a host (test/fixtures/project-hosts.json)', (t) => {
  const P = project(t);
  // every reserved label is refused too, whether or not labelCases lists it
  const names = [...new Map([...HOSTS.labelCases.filter((c) => PUBLIC_PROJECT.test(c.name)).map((c) => [c.name, c.expect]), ...HOSTS.reservedLabels.map((l) => [l, 'refused'])]).entries()];
  assert.ok(names.some(([, e]) => e === 'refused') && names.some(([, e]) => e !== 'refused'), 'the fixture has both');
  for (const [name, expect] of names) {
    P.rename(name);
    const said = P.manifest('landed-mock', ON);
    if (expect === 'refused') {
      assert.match(said, new RegExp(`${head(name, 'landed-mock')}it would have no address: ${esc(name)} can't be a host name, so rename the project \\(settings\\.md's project\\)$`), `${name}: ${said}`);
      assert.doesNotMatch(said, /https:\/\//, said);
    } else {
      assert.match(said, new RegExp(`${head(name, 'landed-mock')}it is https://${esc(name)}\\.<box>/landed-mock/$`), `${name} (${expect}): ${said}`);
    }
    // an image before project hosts serves every one under public.<box>, as before
    assert.match(P.manifest('landed-mock'), new RegExp(`${head(name, 'landed-mock')}it is https://public\\.<box>/${esc(name)}/landed-mock/$`), name);
  }
});

test('C4 with DEVTEAM_PROJECT_HOSTS=1, an artifact named after one of the dashboard\'s paths gets no address, and is told to rename', (t) => {
  const reserved = HOSTS.reservedSegments.filter((s) => LINK_ID.test(s));
  assert.ok(reserved.length >= 5, 'the fixture names them');
  const P = project(t, ['landed-mock', ...reserved]);
  for (const s of reserved) {
    const said = P.manifest(s, ON);
    assert.match(said, new RegExp(`${head('demo', s)}it would have no address: ${esc(s)} is a path of the dashboard, so rename the artifact$`), `${s}: ${said}`);
    assert.match(P.manifest(s), new RegExp(`${head('demo', s)}it is https://public\\.<box>/demo/${esc(s)}/$`), s);
  }
  // both wrong: the slug is said first, as the gateway's Publish checks it
  P.rename('my_app');
  assert.match(P.manifest('api', ON), /it would have no address: api is a path of the dashboard, so rename the artifact$/);
});

test('C5 artifact manifest --json is the same with and without DEVTEAM_PROJECT_HOSTS=1', (t) => {
  const P = project(t);
  const a = P.json('landed-mock', {});
  assert.deepEqual(P.json('landed-mock', ON), a);
  assert.deepEqual(Object.keys(a).sort(), ['files', 'project', 'public', 'root', 'slug', 'summary', 'title', 'tree']);
});

test('C6 supervisor.md\'s "Publishing is the owner\'s" rule gives https://<project>.<box>/<slug>/, and public.<box>/<project>/<slug>/ on a box image from before it', () => {
  const doc = fs.readFileSync(path.join(kit, 'process', 'supervisor.md'), 'utf8');
  const rule = doc.split('\n').filter((l) => l.startsWith('- **Publishing is the owner\'s.**'));
  assert.equal(rule.length, 1, 'one rule');
  assert.match(rule[0], /readable by anyone at `https:\/\/<project>\.<box>\/<slug>\/` \(`public\.<box>\/<project>\/<slug>\/` on a box image from before it\)/, rule[0]);
});
