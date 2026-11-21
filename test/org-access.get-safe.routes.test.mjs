// org-access A13: the routes listed from the code are the routes asked, and Check now fetches by POST only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { dashboardOnFreePort } from './lib/kit.mjs';
import { envOf, getSafeFixture, gitOut, PARTS, readCmds, REQUESTS, settled } from './lib/org-access-fixture.mjs';

const KIT_SCRIPT = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'docs', 'devteam', 'scripts', 'devteam.mjs');
const SRC = fs.readFileSync(KIT_SCRIPT, 'utf8');

// ----- the routes, from the code -----
// Between two lines of the source: the first that matches from, then the first after it that matches to.
const span = (from, to) => {
  const lines = SRC.split('\n');
  const a = lines.findIndex((l) => from.test(l));
  assert.ok(a >= 0, `devteam.mjs has a line matching ${from}`);
  const b = lines.findIndex((l, i) => i > a && to.test(l));
  assert.ok(b > a, `devteam.mjs has a line matching ${to} after ${from}`);
  return lines.slice(a, b + 1);
};
// what a request's path is held in, in these handlers
const PV = String.raw`(?:\bu\.pathname|\burl\.pathname|\bpathname|\breq\.url|\brawPath)`;
// a line that tests a path: compares it, prefix- or suffix-matches it, looks inside it, or runs a regex on it
const TESTS_PATH = new RegExp(String.raw`${PV}\s*[!=]==?|${PV}\.(?:startsWith|endsWith|includes|match|search)\(|\.(?:exec|test)\(\s*${PV}`);
// a regex literal: escapes, character classes (which may hold a bare /), and anything but / or a newline
const RE = String.raw`\/((?:\\.|\[(?:\\.|[^\]\\])*\]|[^\/\\\n\[])+)\/[dgimsuy]*`;
const Q = String.raw`(['"\x60])((?:(?!\1)[^\\]|\\.)*)\1`;
// The keys one line names: a literal compared (any quotes), prefix-matched (key ends in *), or a regex run on the path.
const pathsOf = (l) => [
  ...[...l.matchAll(new RegExp(String.raw`${PV}\s*[!=]==?\s*${Q}`, 'g'))].map((m) => m[2]),
  ...[...l.matchAll(new RegExp(String.raw`${PV}\.startsWith\(\s*${Q}\s*\)`, 'g'))].map((m) => `${m[2]}*`),
  ...[...l.matchAll(new RegExp(String.raw`${RE}\.(?:exec|test)\(\s*${PV}`, 'g'))].map((m) => `re:${m[1]}`),
  ...[...l.matchAll(new RegExp(String.raw`${PV}\.(?:match|search)\(\s*${RE}`, 'g'))].map((m) => `re:${m[1]}`),
];
// a line for another method only: it names one and names neither GET nor HEAD
const otherMethodOnly = (l) => /'(?:POST|PUT|PATCH|DELETE|OPTIONS)'/.test(l) && !/'(?:GET|HEAD)'/.test(l);
// Every key in the four places, each with whether its line names HEAD; and every path-testing line
// that gave no key (the listing can't read it: the test fails on it).
function listRoutes() {
  const keys = new Map();
  const unread = [];
  const take = (where, lines, { skip = () => false } = {}) => {
    for (const [i, l] of lines.entries()) {
      if (!TESTS_PATH.test(l) || otherMethodOnly(l) || skip(i, l)) continue;
      const ps = pathsOf(l);
      if (!ps.length) unread.push(`${where}: ${l.trim()}`);
      for (const p of ps) keys.set(`${where} ${p}`, (keys.get(`${where} ${p}`) ?? false) || /'HEAD'/.test(l));
    }
  };
  take('dash', span(/^\/\* dashboardRoutes start \*\//, /^\/\* dashboardRoutes end \*\//));
  take('dash', span(/const server = http\.createServer\(async \(req, res\) => \{/, /for \(const route of DASHBOARD_ROUTES\)/));
  take('term', span(/^  function route\(pathname\) \{/, /^  \}/));
  take('hub', span(/const hub = trackRequests\(http\.createServer\(async \(req, res\) => \{/, /^    current = hub;/));
  return { keys, unread };
}

// Keys the listing finds that are not routes of their own, each with why: what asks them.
const NOT_ROUTES = {
  'dash /api/term/*': "the terminal's dispatch: its routes are listed from route() (term …)",
  'dash re:^\\/artifact\\/(?:main|wt\\/([^/]+)|tree\\/([0-9a-f]{40}(?:[0-9a-f]{24})?))\\/([^/]+)(\\/.*)?$': "/artifact/*'s own parse of the path it matched: asked by dash /artifact/*",
  'dash re:^\\/artifact\\/origin\\/([^/]+)\\/([^/]+)(\\/.*)?$': "/artifact/*'s parse of a draft from another machine (kit-750): asked by dash /artifact/*",
  'hub /*': "the redirect of a request on another Host to 127.0.0.1, the same request again: asked by every hub key's request on that Host",
};

const post = (port, p, headers = {}, body = '{}') => new Promise((resolve) => {
  const r = http.request({ host: '127.0.0.1', port, path: p, method: 'POST', headers: { host: `127.0.0.1:${port}`, 'content-length': Buffer.byteLength(body), ...headers } }, (res) => { let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve({ status: res.statusCode, body: b })); });
  // a body cut off: the connection's end is the answer
  r.on('error', (e) => resolve({ status: null, body: e.code ?? e.message }));
  r.setTimeout(120000, () => r.destroy(new Error(`POST ${p}: no answer in 2 min`)));
  r.end(body);
});

test('org-access A13: the routes listed from the code are exactly the routes this test asks, and every path test is read', () => {
  const F = { slug: 's', wt: 'w', preview: 'p', ticket: 't', upload: 'u', sensor: 'n', review: 'q' };
  const { keys, unread } = listRoutes();
  assert.deepEqual(unread, [], 'a line tests a path in a way the listing cannot read: teach pathsOf its form');
  const listed = [...keys.keys()].sort();
  const asked = [...Object.keys(REQUESTS(F)), ...Object.keys(NOT_ROUTES)].sort();
  assert.ok(listed.length >= 30, `the routes found: ${listed.join(', ')}`);
  assert.deepEqual(listed.filter((k) => !asked.includes(k)), [], 'a route the test does not ask: add its requests to REQUESTS');
  assert.deepEqual(asked.filter((k) => !listed.includes(k)), [], 'a route the test asks that the code no longer has');
  // A13's parts ask every key once, in order
  for (const [mode, slices] of Object.entries(PARTS)) assert.deepEqual(slices.flat(), Object.keys(REQUESTS(F)), `PARTS.${mode}: every key of REQUESTS once, in order`);
  // a line that names HEAD serves it: its key's first request is asked as HEAD too (every key's is)
  assert.ok(keys.get('dash /upload/*'), "/upload/*'s line names HEAD");
});

test('org-access A13: Check now fetches by POST /api/fleet-check, from the page\'s own origin only', { timeout: 300000 }, async () => {
  const F = getSafeFixture();
  try {
    const { dash, port } = await dashboardOnFreePort(F.old, envOf(F));
    try {
      const leaders = [dash.p.pid];
      await settled(F, leaders);
      const own = { origin: `http://127.0.0.1:${port}`, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' };
      // refused before anything runs: another site's page, a sandboxed frame (Origin: null), a client
      // that says neither (curl), a body that isn't JSON, and a body over the cap (cut off)
      const refused = [
        ['cross-site', { ...own, origin: 'https://elsewhere.example', 'sec-fetch-site': 'cross-site' }, '{}', 403],
        ['Origin: null', { origin: 'null', 'content-type': 'application/json' }, '{}', 403],
        ['no Origin and no Sec-Fetch-Site', { 'content-type': 'application/json' }, '{}', 403],
        ['text/plain', { ...own, 'content-type': 'text/plain' }, '{}', 403],
        ['a body over 20000 bytes', own, `{"x":"${'a'.repeat(100000)}"}`, null],
      ];
      for (const [what, headers, body, status] of refused) {
        fs.writeFileSync(F.cmds, '');
        const r = await post(port, '/api/fleet-check', headers, body);
        await settled(F, leaders);
        if (status === null) assert.notEqual(r.status, 200, `${what}: not answered as a check`);
        else assert.equal(r.status, status, `${what}: ${r.body}`);
        assert.deepEqual(readCmds(F).map((c) => `${path.basename(c.file)} ${c.args.join(' ')}`), [], `${what}: a refused check starts nothing`);
      }
      // the page's own: fleet status, after a fetch from origin
      fs.writeFileSync(F.cmds, '');
      const ok = await post(port, '/api/fleet-check', own);
      await settled(F, leaders);
      assert.equal(ok.status, 200, `the check: ${ok.body}`);
      assert.ok(Array.isArray(JSON.parse(ok.body).blockers), 'the answer is fleet status');
      assert.ok(readCmds(F).some((c) => path.basename(c.file) === 'git' && c.args.includes('fetch')), 'the check fetched from origin');
      assert.equal(gitOut(F.old, ['rev-parse', 'origin/main']).trim(), gitOut(F.org, ['rev-parse', 'main']).trim(), "origin/main moved to origin's main");
      // home's origin gone: the check says it couldn't fetch, never a 200 that reads as checked (kit-339)
      F.g(['remote', 'set-url', 'origin', path.join(F.base, 'gone.git')], F.old);
      const gone = await post(port, '/api/fleet-check', own);
      await settled(F, leaders);
      assert.equal(gone.status, 502, `home's origin gone: ${gone.body}`);
      assert.match(JSON.parse(gone.body).error ?? '', /could not fetch origin/, 'the answer says why');
      // and how to clear it (kit-341): a fetch from a terminal, which shows why; the agent and the saved login
      // only when a key or a password was needed, since the fetch can't prompt
      const HINT = /^home: could not fetch origin: .*; what its sessions pushed is unchecked\. Run git fetch origin in a terminal to see why, then check again$/;
      assert.match(JSON.parse(gone.body).error ?? '', HINT, 'the answer says how to clear it');
      // the CLI's blocker is the same words
      const cli = F.run(F.old, ['fleet', 'status', '--json'], { HOME: F.home });
      assert.equal(cli.status, 0, `fleet status: ${cli.err}`);
      assert.ok(JSON.parse(cli.out).blockers.some((b) => HINT.test(b)), `the CLI's blocker says how to clear it: ${cli.out}`);
      // a key that needed a passphrase (ssh refuses it: no agent, and BatchMode): the agent and the saved login too
      const sshStub = path.join(F.base, 'ssh-denied.sh');
      fs.writeFileSync(sshStub, '#!/bin/sh\necho "git@origin.invalid: Permission denied (publickey)." >&2\nexit 255\n', { mode: 0o755 });
      F.g(['remote', 'set-url', 'origin', 'ssh://git@origin.invalid/x.git'], F.old);
      try {
        const denied = F.run(F.old, ['fleet', 'status', '--json'], { HOME: F.home, GIT_SSH_COMMAND: sshStub });
        assert.equal(denied.status, 0, `fleet status: ${denied.err}`);
        const LOGIN = /^home: could not fetch origin: git@origin\.invalid: Permission denied \(publickey\)\.; what its sessions pushed is unchecked\. The fetch can't prompt: load the ssh key into an agent \(ssh-add\) or save an https login \(a git credential helper\), or run git fetch origin in a terminal, then check again$/;
        assert.ok(JSON.parse(denied.out).blockers.some((b) => LOGIN.test(b)), `a key refused: the agent and the saved login: ${denied.out}`);
        assert.ok(!JSON.parse(cli.out).blockers.some((b) => /ssh-add/.test(b)), 'a missing repository gets no ssh-add advice');
      } finally { F.g(['remote', 'set-url', 'origin', path.join(F.base, 'gone.git')], F.old); }
      // home's origin hung (it takes the connection and never answers): the check is stopped at its
      // deadline, 12 s, and says so, never holding the request
      const held = new Set();
      const hang = net.createServer((s) => { held.add(s); s.on('error', () => {}); });
      await new Promise((r) => hang.listen(0, '127.0.0.1', r));
      try {
        F.g(['remote', 'set-url', 'origin', `http://127.0.0.1:${hang.address().port}/origin.git`], F.old);
        const t0 = Date.now();
        const hung = await post(port, '/api/fleet-check', own);
        const took = Date.now() - t0;
        assert.equal(hung.status, 500, `home's origin hung: ${hung.body}`);
        assert.match(JSON.parse(hung.body).error ?? '', /took over 12 s/, 'the answer says it was stopped');
        assert.ok(took >= 11000 && took < 20000, `answered at the deadline, not before or long after: ${took} ms`);
      } finally {
        for (const s of held) s.destroy();
        await new Promise((r) => hang.close(r));
        F.g(['remote', 'set-url', 'origin', F.org], F.old);
      }
      await settled(F, leaders);
    } finally { await dash.stop(); }
  } finally { F.done(); }
});
