// The kit's gitleaks config (docs/devteam/gitleaks.toml): a project that scans its history with
// gitleaks, and extends it, isn't failed by the kit's own log, and still is by a real secret on a
// log line. With gitleaks on PATH (CI installs it and sets DEVTEAM_TEST_GITLEAKS=1, so it can't be
// skipped there) both sides run through gitleaks itself, over a git history; without it, the
// allowlist's regex is checked against the same lines, and the test says so.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const kit = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'devteam');
const config = fs.readFileSync(path.join(kit, 'gitleaks.toml'), 'utf8');
const hasGitleaks = spawnSync('gitleaks', ['version'], { encoding: 'utf8' }).status === 0;
if (process.env.DEVTEAM_TEST_GITLEAKS === '1') assert.ok(hasGitleaks, 'DEVTEAM_TEST_GITLEAKS=1 but gitleaks is not on PATH');

// Secret-shaped strings made at run time, so no literal key sits in this file for a scanner (or a
// forge's push protection) to find. Deterministic: the same strings every run.
const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const fake = (n, seed) => { let x = seed, s = ''; for (let i = 0; i < n; i++) { x = (x * 1103515245 + 12345) % 2147483648; s += ALNUM[x % ALNUM.length]; } return s; };
const genericKey = fake(32, 7);
// lowercase, dash-joined and starting like an id: shaped as a key's segments, not as words
const dashed = 'zq-81734-7k2m9x4c-3p8w5t1h-9d4f2j6v';
const githubPat = `${'gh'}p_${fake(36, 11)}`;

const at = '2026-11-11T16:16:36.488Z';
const obs = (id, fields) => `${JSON.stringify({ v: 1, id, type: 'observation', op: 'new', at, by: 'supervisor', source: 'supervisor', subject: 'spend', kind: 'spend-spike', severity: 2, valence: -1, ...fields })}\n`;
// What the kit writes: a source_key slug with digits in it, the shape that tripped generic-api-key
const kitLines = [
  obs('o-20261111-161636488-supervisor', { detail: 'spend doubled on the 9th and 10th', source_key: 'anthropic-spend-spike-nov9-10' }),
  obs('o-20261111-170235760-supervisor', { detail: 'p95 over target for 3 checks', source_key: 'incident-2026-11-11-api-p95' }),
  obs('o-20261111-170235761-supervisor', { detail: 'one resend', source_key: 'resent-enter2 pane:w1 3f2a9b8c7d6e' }),
  obs('o-20261111-170235762-supervisor', { detail: 'a slow suite', source_key: 'slow:auth-suite' }),
  // refs naming ticket ids, one with "secrets" in its slug (a real project log's shape)
  obs('o-20261111-170235768-supervisor', { detail: 'app-45 now depends on app-41.', refs: ['app-41-secrets-gate,ops-43-ci-floor-gates'] }),
];
// A real secret on a log line: in free text, in a sensor's sample, under a key the kit doesn't
// write, and as a source_key value that isn't a slug
const leakLines = {
  detail: obs('o-20261111-170235763-supervisor', { detail: `the probe printed api_key=${genericKey} in its output`, source_key: 'probe-output-2026' }),
  sample: obs('o-20261111-170235764-supervisor', { detail: 'a log line', sample: `POST /hooks/deploy 401 secret=${genericKey} rejected`, source_key: 'sensor:web:log-error:abc' }),
  nested: obs('o-20261111-170235765-supervisor', { detail: 'x', my_source_key: genericKey }),
  value: obs('o-20261111-170235766-supervisor', { detail: 'x', source_key: genericKey }),
  pat: obs('o-20261111-170235767-supervisor', { detail: 'x', source_key: githubPat }),
  // a key where the second ticket id would be, as it is and as a lowercase dash-joined value
  afterId: obs('o-20261111-170235769-supervisor', { detail: 'x', refs: [`app-41-secrets-gate,${genericKey}`] }),
  dashedAfterId: obs('o-20261111-170235770-supervisor', { detail: 'x', refs: [`app-41-secrets-gate,${dashed}`] }),
};

test('the kit config allowlists only generic-api-key, only on the source_key JSON key and runs of kit ticket ids', () => {
  assert.match(config, /^\[extend\]\nuseDefault = true$/m, "it keeps gitleaks' default rules");
  const body = config.replace(/^#.*\n/gm, '');
  assert.equal(body.match(/^\[\[rules\]\]$/gm)?.length, 1, 'one rule');
  assert.match(body, /^\[\[rules\]\]\nid = "generic-api-key"\n\[\[rules\.allowlists\]\]\n/m, 'an allowlist on the generic rule only: every specific rule still sees the value');
  assert.doesNotMatch(body, /^(regex|path|entropy|keywords) =/m, "the default rule's regex, entropy and keywords stay as they are");
  assert.equal(body.match(/allowlists\]\]$/gm)?.length, 1, 'one allowlist, no global one');
  assert.equal(allows.length, 2, 'two shapes: a source_key slug, and a run of ticket ids');
  assert.match(body, /^regexTarget = "match"$/m, 'matched on the finding, key name included, never the whole line');
  assert.doesNotMatch(config, /^\s*(paths|stopwords|commits)\s*=/m, 'no path, stopword or commit allowlist: a log file is scanned like any other');
});

// The allowlist's regex as gitleaks applies it, to a generic-api-key finding's match.
const allows = [...config.matchAll(/^\s*'''(.+)''',?$/gm)].map((m) => new RegExp(m[1]));
const allow = { test: (m) => allows.some((r) => r.test(m)) };
test('the allowlist regex: a source_key slug passes, anything else on the line does not', (t) => {
  if (!hasGitleaks) t.diagnostic('gitleaks is not on PATH: checking the regex only (the next test runs gitleaks itself where it is)');
  // the matches gitleaks reports for the kit's lines (the value up to its terminator)
  for (const m of ['source_key":"anthropic-spend-spike-nov9-10"', 'source_key":"incident-2026-11-11-api-p95"', 'source_key":"resent-enter2 ', 'source_key": "fix_2026.11.9"']) assert.ok(allow.test(m), m);
  for (const m of [
    `api_key=${genericKey} `, `auth_token": "${genericKey}"`, `my_source_key":"${genericKey}"`, `source_key":"${genericKey}"`,
    // base64's + / =, a run over 20, a value cut where gitleaks cuts it, another key name
    'source_key":"abc+def/ghi=12345"', `source_key":"spike-${fake(21, 3)}"`, 'source_key":"abc-12345;', 'SOURCE_KEY":"abc-12345"', 'detail":"abc-12345"',
  ]) assert.ok(!allow.test(m), m);
  // two kit ticket ids, one with "secrets" in its slug: what a refs list of a real log carried
  for (const m of ['app-41-secrets-gate,ops-43-ci-floor-gates"', 'ops-12-api-keys, app-7-token-cache-v2 ']) assert.ok(allow.test(m), m);
  for (const m of [`app-41-secrets-gate,${genericKey}"`, 'app-41-secrets-gate,ops-43-ci-Floor-gates"', `app-41-secrets-gate,ops-43-${fake(21, 5).toLowerCase()}"`, 'app-41-secrets-gate"', `app-41-secrets-gate,${dashed}"`, 'xx=app-41-secrets-gate,ops-43-ci-floor-gates"', 'app-41-secrets-gate,ops-43-a-b-c-d-e-f-g-h"']) assert.ok(!allow.test(m), m);
});

const scan = (dir, args = []) => {
  const report = path.join(dir, '..', `${path.basename(dir)}-report.json`);
  const r = spawnSync('gitleaks', ['git', '.', '--no-banner', '--redact', '--report-format', 'json', '--report-path', report, ...args], { cwd: dir, encoding: 'utf8' });
  assert.ok(r.status === 0 || r.status === 1, `gitleaks failed: ${r.stderr}`);
  return JSON.parse(fs.readFileSync(report, 'utf8'));
};
const repoWith = (root, name, lines, { extend = true } = {}) => {
  const dir = path.join(root, name);
  const git = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'pipe' });
  fs.mkdirSync(path.join(dir, 'docs/devteam/project/log'), { recursive: true });
  fs.copyFileSync(path.join(kit, 'gitleaks.toml'), path.join(dir, 'docs/devteam/gitleaks.toml'));
  // what init writes
  if (extend) fs.writeFileSync(path.join(dir, '.gitleaks.toml'), '# extends the kit\n[extend]\npath = "docs/devteam/gitleaks.toml"\n');
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 't');
  git('config', 'commit.gpgsign', 'false');
  git('add', '-A');
  git('commit', '-qm', 'kit');
  fs.writeFileSync(path.join(dir, 'docs/devteam/project/log/supervisor-2026-11.jsonl'), lines.join(''));
  git('add', '-A');
  git('commit', '-qm', 'log');
  return dir;
};

test('gitleaks itself: the kit log passes, a secret on a log line still fails', { skip: !hasGitleaks && 'gitleaks is not on PATH (the regex test above covers the config)' }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-gitleaks-'));
  try {
    // without the kit's config, the kit's own log fails the scan: what a project hit
    const bare = scan(repoWith(root, 'bare', kitLines, { extend: false }));
    assert.ok(bare.some((f) => f.RuleID === 'generic-api-key' && /source_key/.test(f.Match)), `the default rules flag source_key: ${JSON.stringify(bare.map((f) => f.Match))}`);
    // with it, extended from the project's .gitleaks.toml, the scan is clean
    const clean = scan(repoWith(root, 'clean', kitLines));
    assert.deepEqual(clean.map((f) => `${f.RuleID} ${f.Match}`), [], 'the kit log passes');
    for (const [name, l] of Object.entries(leakLines)) {
      const found = scan(repoWith(root, `leak-${name}`, [...kitLines, l]));
      assert.ok(found.length, `${name}: the secret is still found`);
      assert.ok(found.every((f) => f.StartLine === kitLines.length + 1), `${name}: only the leaking line, never the kit's (${JSON.stringify(found.map((f) => [f.StartLine, f.RuleID]))})`);
      if (name === 'pat') assert.ok(found.some((f) => f.RuleID === 'github-pat'), 'a specific rule still sees a source_key value');
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
