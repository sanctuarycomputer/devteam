// project-hosts@1: the address of a project on a box (<project>.<box>), held in three places that
// must agree: the section of cloud/gateway.mjs's header comment that defines it, the cases in
// test/fixtures/project-hosts.json that the gateway's, the hub's and the dashboard's tests read, and
// the routes the dashboard server answers, which a published page must never shadow.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');
const F = JSON.parse(read('test', 'fixtures', 'project-hosts.json'));
const OLD_ADDRESS = /public\.box\.example\.com|(?:[0-9]+|<port>)\.box\.example\.com/;

// The header's project-hosts@1 section: only the lines between its first and last line, as text.
function section() {
  const src = read('cloud', 'gateway.mjs');
  const header = src.slice(0, src.search(/^import /m)).split('\n');
  const start = header.findIndex((l) => /^\/\/ project-hosts@1\b/.test(l));
  const end = header.findIndex((l) => /^\/\/ end project-hosts@1\s*$/.test(l));
  assert.ok(start > 0, "the gateway's header has a line '// project-hosts@1'");
  assert.ok(end > start, "the section ends at a line '// end project-hosts@1'");
  const lines = header.slice(start + 1, end);
  assert.ok(lines.every((l) => l.startsWith('//')), 'the section is comment lines only');
  return lines.map((l) => l.replace(/^\/\/ ?/, ''));
}
const sectionText = () => section().join(' ').replace(/\s+/g, ' ');

// The rule as the header writes it: a line 'label: /…/'.
function headerLabelRule() {
  const line = section().find((l) => /^\s*label: \//.test(l));
  assert.ok(line, "the section has a line 'label: /…/'");
  const m = /label: \/(.+)\/([a-z]*)\s*$/.exec(line);
  assert.ok(m, 'the label line holds one regular expression');
  return new RegExp(m[1], m[2]);
}

// The reference: what a name's host is, from the label rule and the hub's lists.
function hostOf(name, projects, previews, label = headerLabelRule()) {
  if (!label.test(name)) return { expect: 'refused', reason: /^\d+$/.test(name) ? 'all-digits' : 'not-a-label' };
  if (F.reservedLabels.includes(name)) return { expect: 'refused', reason: 'reserved' };
  const n = projects.filter((p) => p === name).length;
  if (n >= 2) return { expect: 'shared' };
  if (n === 1) return { expect: 'project' };
  if (previews.includes(name)) return { expect: 'preview' };
  return { expect: 'unknown' };
}

// The reference: what answers an address on the box, in the gateway's order.
function answerOf(href, label = headerLabelRule()) {
  const u = new URL(href);
  const box = F.box.name;
  if (u.hostname === box) return 'box';
  assert.ok(u.hostname.endsWith(`.${box}`), `${href} is under ${box}`);
  const name = u.hostname.slice(0, -box.length - 1);
  assert.ok(!name.includes('.'), `${href} is one label under ${box}`);
  if (name === 'term') return 'terminal';
  const host = hostOf(name, F.box.projects, F.box.previews, label);
  if (host.expect === 'refused') return 'gone';
  const first = u.pathname.split('/')[1] ?? '';
  if (!F.reservedSegments.includes(first) && (F.box.published[name] ?? []).includes(first)) return 'public-page';
  return { project: 'dashboard', shared: 'no-dashboard', preview: 'preview', unknown: 'unknown' }[host.expect];
}

test('the fixture names its contract, and its reserved labels and segments are distinct, lowercase and non-empty', () => {
  assert.equal(F.contract, 'project-hosts@1');
  for (const [what, list] of [['reservedLabels', F.reservedLabels], ['reservedSegments', F.reservedSegments]]) {
    assert.ok(Array.isArray(list) && list.length > 0, `${what} is a list`);
    assert.equal(new Set(list).size, list.length, `${what} are distinct`);
    for (const x of list) assert.ok(typeof x === 'string' && x.length > 0 && x === x.toLowerCase(), `${what}: ${JSON.stringify(x)}`);
  }
  for (const l of ['term', 'public', 'www']) assert.ok(F.reservedLabels.includes(l), `${l} is reserved`);
});

test("the header's project-hosts@1 section says the whole definition", () => {
  const t = sectionText();
  const must = [
    [/https:\/\/<project>\.<box>\//, 'a project at https://<project>.<box>/'],
    [/sign-in/i, 'behind sign-in'],
    [/\/<artifact>\//, 'public pages at /<artifact>/'],
    [/anyone/i, 'for anyone'],
    [/all digits/i, 'not all digits'],
    [/two projects share/i, 'a name two projects share'],
    [/no dashboard/i, '… gets no dashboard'],
    [/stored pages still answer/i, "… its stored pages still answer"],
    [/preview/i, 'a preview whose name is a project’s'],
    [/not served under/i, '… is not served under it'],
    [/hub's list/i, "known from the hub's list"],
    [/gateway's store/i, "… or the gateway's store"],
    [/checked before the store/i, 'reserved segments checked before the store'],
    [/box: 2/, 'box.json box: 2'],
    [/\{project\}/, 'the {project} template'],
    [/in place of `instance`/, 'project in place of instance'],
    [/box's own name/i, "the box's own name keeps"],
    [/\bhub\b/i, '… the hub'],
    [/passkeys/i, '… passkeys'],
    [/pushes/i, '… pushes'],
    [/\/dev\//, '… /dev/'],
  ];
  for (const [re, what] of must) assert.match(t, re, `the section says: ${what}`);
  for (const l of F.reservedLabels) assert.ok(t.includes(`\`${l}\``), `the section names the reserved label \`${l}\``);
  for (const s of F.reservedSegments) assert.ok(t.includes(`\`${s}\``), `the section names the reserved segment \`${s}\``);
});

test('every label case follows the rule as the header writes it', () => {
  const label = headerLabelRule();
  const seen = new Set();
  for (const c of F.labelCases) {
    const got = hostOf(c.name, c.projects ?? [c.name], c.previews ?? [], label);
    assert.deepEqual(got, c.reason ? { expect: c.expect, reason: c.reason } : { expect: c.expect }, `label case ${JSON.stringify(c)}`);
    seen.add(c.reason ?? c.expect);
  }
  for (const k of ['project', 'shared', 'preview', 'unknown', 'not-a-label', 'all-digits', 'reserved']) assert.ok(seen.has(k), `a label case gives ${k}`);
});

test('every sample address parses and is answered as the rule says, reserved segments before the store', () => {
  const label = headerLabelRule();
  const seen = new Set();
  for (const s of F.samples) {
    assert.equal(answerOf(s.url, label), s.expect, s.url);
    seen.add(s.expect);
  }
  for (const k of ['box', 'terminal', 'dashboard', 'public-page', 'no-dashboard', 'preview', 'unknown', 'gone']) assert.ok(seen.has(k), `a sample is answered: ${k}`);
  // the order: a page published under a reserved segment never answers
  const shadowed = Object.entries(F.box.published).flatMap(([n, slugs]) => slugs.filter((x) => F.reservedSegments.includes(x)).map((x) => `https://${n}.${F.box.name}/${x}/`));
  assert.ok(shadowed.length > 0, 'the box has a page published under a reserved segment');
  assert.ok(shadowed.some((u) => F.samples.some((s) => s.url === u)), 'a sample asks for it');
  // a name only the store knows (a stopped project) still answers its pages
  const storeOnly = Object.keys(F.box.published).filter((n) => !F.box.projects.includes(n) && !F.box.previews.includes(n));
  assert.ok(storeOnly.some((n) => F.samples.some((s) => s.expect === 'public-page' && new URL(s.url).hostname === `${n}.${F.box.name}`)), "a store-only name's page is a sample");
});

test('box.json box: 2 names the project template in place of instance', () => {
  assert.equal(F.boxJson.box, 2);
  assert.ok(F.boxJson.project.includes('{project}'), 'project holds {project}');
  assert.ok(!('instance' in F.boxJson), 'no instance');
  assert.equal(new URL(F.boxJson.project.replace('{project}', 'alpha')).hostname, `alpha.${F.box.name}`);
});

test("every first segment the dashboard server answers is reserved, so no published page can shadow it", () => {
  const src = read('docs', 'devteam', 'scripts', 'devteam.mjs');
  const mark = src.indexOf('the dashboard answers only on its own address');
  assert.ok(mark > 0, "the dashboard server's host check is in devteam.mjs");
  const start = src.lastIndexOf('http.createServer(', mark);
  const end = src.indexOf('server.listen(port, host)', mark);
  assert.ok(start > 0 && end > mark, "the dashboard server's handler is found");
  const handler = src.slice(start, end);
  const segs = new Set();
  // a path literal, quoted or a template, whatever it is compared with; a segment ends at / ? or #
  for (const m of handler.matchAll(/['"`]\/([a-z][a-z0-9.-]*)/g)) segs.add(m[1]);
  // a route regex, /^\/view\/…/
  for (const m of handler.matchAll(/\/\^\\\/([a-z][a-z0-9.-]*)/g)) segs.add(m[1]);
  assert.ok(segs.size >= 6, `found the server's routes (${[...segs].join(', ')})`);
  for (const s of segs) assert.ok(F.reservedSegments.includes(s), `the dashboard answers /${s}, so the fixture reserves it`);
});

test("README's cloud section says where a project is, and names no old address", () => {
  const readme = read('README.md');
  assert.doesNotMatch(readme, OLD_ADDRESS, 'README.md names no port host and no public. host');
  const at = readme.indexOf('## Optional: running it in the cloud');
  assert.ok(at >= 0, 'README has its cloud section');
  const next = readme.indexOf('\n## ', at + 1);
  const cloud = readme.slice(at, next < 0 ? undefined : next);
  sayEach(cloud, 'README');
});

test("cloud/Dockerfile's header comment says the same, and names no old address", () => {
  const df = read('cloud', 'Dockerfile');
  const comments = df.slice(0, df.search(/^FROM /m)).split('\n').filter((l) => l.startsWith('#')).join('\n');
  assert.doesNotMatch(comments, OLD_ADDRESS, "the Dockerfile's comments name no port host and no public. host");
  sayEach(comments, 'the Dockerfile');
});

function sayEach(text, where) {
  const t = text.replace(/\s+/g, ' ');
  const must = [
    [/<project>\.box\.example\.com/, 'each project at its own <project>.box.example.com'],
    [/sign(?:-| )in/i, 'private views after sign-in'],
    [/\/<artifact>\//, 'public pages at /<artifact>/'],
    [/anyone/i, '… for anyone'],
    [/redirect/i, 'the old names are not redirected'],
    [/certificate/i, 'the wildcard certificate covers every project host'],
    [/settings\.md/, "name a project with settings.md's project"],
    [/`project`/, "… its `project`"],
  ];
  for (const [re, what] of must) assert.match(t, re, `${where} says: ${what}`);
}
