// The browser handover (kit-67): the supervisor hands the agent browser to the owner for a login
// with one owner-action question (class browser-handover, scope browser:<instance key>), and the
// browser is held until the owner answers. Each check is the spec's
// (docs/devteam/project/tickets/kit-67-browser-handover/spec.md, home), named by its id. The asking
// checks need no Chrome and run on every Node; the Chrome checks skip without canDrive.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { canDrive } from './lib/chrome.mjs';
import { monoFixture } from './lib/kit.mjs';
import { validate } from './fixtures/browser/check.mjs';
import { handoverFile, project, kit, browser, owner, answerLines, appendLine, readLedger, site, CHOICES, qidOf, ok, withdraw } from './lib/browser-handover-fixture.mjs';

handoverFile();

// CI's Node 22 and 24 jobs have Chrome: there the file must run, never skip.
const mustRun = !!process.env.CI && Number(process.versions.node.split('.')[0]) >= 22;
const skip = canDrive ? false : 'needs Chrome and Node 22+';
// the Chrome checks take these (later tasks)
const chromeOpts = { skip, timeout: 120000 };
if (mustRun && !canDrive) test('Chrome is needed on CI\'s Node 22+', () => assert.fail('Chrome is needed on CI\'s Node 22+: this file must run there, not skip'));

const SUP = { DEVTEAM_ROLE: 'supervisor' };
const KEY = 'probe67-0123456789ab';
const CHOICE_JSON = JSON.stringify(CHOICES);

// One project for the asking checks; every line the log holds, counted across its files.
let F;
const fx = () => (F ??= monoFixture('handover-ask'));
test.after(() => F?.done());
const logLines = () => {
  const dir = path.join(fx().old, 'docs/devteam/run/log');
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).reduce((n, f) => n + fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter((l) => l.trim()).length, 0);
};
const ask = (...extra) => fx().run(fx().old, ['ask', '--question', 'Log in to the fixture site, then press Done', '--stake', '2', '--urgency', '2', ...extra], SUP);
const refused = (r, re, n0, why) => {
  assert.equal(r.status, 1, `${why}: exit ${r.status}: ${r.err || r.out}`);
  assert.match(r.err, re, why);
  assert.equal(logLines(), n0, `${why}: no line is added`);
};

test('C2 ask refuses --default on browser-handover', () => {
  const n0 = logLines();
  const r = ask('--kind', 'owner-action', '--class', 'browser-handover', '--scope', `browser:${KEY}`, '--choices', CHOICE_JSON, '--default', 'Done');
  refused(r, /a browser-handover question has no --default: only the owner hands the browser back/, n0, '--default');
  // the default is refused first, before a bad kind or scope
  const r2 = ask('--kind', 'owner-decision', '--class', 'browser-handover', '--scope', 'browser:nope', '--default', 'Done');
  refused(r2, /no --default/, n0, '--default before kind and scope');
});

test('C26 ask refuses a wrong kind or scope, and gives no no-goal warning', () => {
  const n0 = logLines();
  refused(ask('--kind', 'owner-decision', '--class', 'browser-handover', '--scope', `browser:${KEY}`), /browser-handover question is an owner-action/, n0, '--kind owner-decision');
  refused(ask('--class', 'browser-handover', '--scope', `browser:${KEY}`), /browser-handover question is an owner-action/, n0, 'no --kind (an owner-decision)');
  // the kind is refused before the scope
  refused(ask('--kind', 'owner-decision', '--class', 'browser-handover', '--scope', 'browser:nope'), /browser-handover question is an owner-action/, n0, 'kind before scope');
  for (const s of ['browser:nope', `browser:${KEY.toUpperCase()}`, KEY, `browser:${KEY}x`, `browser: ${KEY}`]) {
    refused(ask('--kind', 'owner-action', '--class', 'browser-handover', '--scope', s, '--choices', CHOICE_JSON), /browser-handover question's scope is browser:<instance key>/, n0, `--scope ${s}`);
  }
  refused(ask('--kind', 'owner-action', '--class', 'browser-handover', '--choices', CHOICE_JSON), /browser-handover question's scope is browser:<instance key>/, n0, 'no --scope');
  // with neither problem it is asked, and without the no-goal warning
  const scope = 'browser:c26-aaaaaaaaaaaa';
  const r = ask('--kind', 'owner-action', '--class', 'browser-handover', '--scope', scope, '--choices', CHOICE_JSON);
  assert.equal(r.status, 0, r.err || r.out);
  assert.match(r.out, /^q-\S+$/m);
  assert.doesNotMatch(r.err, /names no --goal/);
  assert.equal(logLines(), n0 + 1);
  // another class still gets the warning
  const o = ask('--kind', 'owner-action', '--class', 'new-feature', '--choices', CHOICE_JSON);
  assert.equal(o.status, 0, o.err || o.out);
  assert.match(o.err, /names no --goal/);
});

test('C10b ask refuses a second open handover of the scope', () => {
  const scope = `browser:${KEY}`;
  const first = ask('--kind', 'owner-action', '--class', 'browser-handover', '--scope', scope, '--choices', CHOICE_JSON);
  assert.equal(first.status, 0, first.err || first.out);
  const qid = first.out.split('\n').find((l) => /^q-/.test(l));
  assert.ok(qid, first.out);
  const n0 = logLines();
  const r = ask('--kind', 'owner-action', '--class', 'browser-handover', '--scope', scope, '--choices', CHOICE_JSON);
  refused(r, new RegExp(`already open.*${qid}|${qid}.*already open`), n0, 'a second handover of the scope');
  // the default and the kind are refused before the open check, on the open scope too
  refused(ask('--kind', 'owner-action', '--class', 'browser-handover', '--scope', scope, '--choices', CHOICE_JSON, '--default', 'Done'), /no --default/, n0, '--default on the open scope');
  refused(ask('--kind', 'owner-decision', '--class', 'browser-handover', '--scope', scope), /browser-handover question is an owner-action/, n0, 'a wrong kind on the open scope');
  // another instance's scope is its own browser: asked
  const other = ask('--kind', 'owner-action', '--class', 'browser-handover', '--scope', 'browser:other-0123456789ab', '--choices', CHOICE_JSON);
  assert.equal(other.status, 0, other.err || other.out);
  assert.equal(logLines(), n0 + 1);
  // a closed handover holds nothing: withdrawn, the scope is asked again
  const w = fx().run(fx().old, ['withdraw', qid, '--reason', 'probe'], SUP);
  assert.equal(w.status, 0, w.err || w.out);
  const n1 = logLines();
  const again = ask('--kind', 'owner-action', '--class', 'browser-handover', '--scope', scope, '--choices', CHOICE_JSON);
  assert.equal(again.status, 0, `after a withdrawn handover: ${again.err || again.out}`);
  assert.equal(logLines(), n1 + 1, 'after a withdrawn handover: one line is added');
  // and answered by the owner (an owner's terminal: no DEVTEAM_*), the scope is asked again
  const qid2 = again.out.split('\n').find((l) => /^q-/.test(l));
  const a = fx().run(fx().old, ['answer', qid2, '--choice', 'Done'], {});
  assert.equal(a.status, 0, a.err || a.out);
  const n2 = logLines();
  const third = ask('--kind', 'owner-action', '--class', 'browser-handover', '--scope', scope, '--choices', CHOICE_JSON);
  assert.equal(third.status, 0, `after an answered handover: ${third.err || third.out}`);
  assert.equal(logLines(), n2 + 1, 'after an answered handover: one line is added');
});

test('ask refuses browser-handover in another case', () => {
  const n0 = logLines();
  // className reads Browser-Handover as browser-handover, so it is refused, not let past every check
  refused(ask('--kind', 'owner-action', '--class', 'Browser-Handover', '--scope', `browser:${KEY}`, '--choices', CHOICE_JSON, '--default', 'Done'), /ask: the class is browser-handover, in lower case/, n0, '--class Browser-Handover');
  refused(ask('--kind', 'owner-action', '--class', 'BROWSER-HANDOVER', '--scope', 'browser:upper-0123456789ab', '--choices', CHOICE_JSON), /ask: the class is browser-handover, in lower case/, n0, '--class BROWSER-HANDOVER');
});

test('fixture: owner answer is written by owner', async () => {
  const P = project('h-sanity');
  const q = await kit(P, ['ask', '--kind', 'owner-action', '--class', 'new-feature', '--question', 'Press Done once the fixture is set up', '--stake', '1', '--urgency', '1', '--choices', CHOICE_JSON]);
  assert.equal(q.status, 0, q.err || q.out);
  const qid = q.out.split('\n').find((l) => /^q-/.test(l));
  assert.ok(qid, q.out);
  const a = await owner(P, ['answer', qid, '--choice', 'Done']);
  assert.equal(a.status, 0, a.err || a.out);
  const lines = answerLines(P);
  assert.equal(lines.length, 1, JSON.stringify(lines));
  assert.equal(lines[0].id, qid);
  assert.equal(lines[0].by, 'owner');
  assert.equal(P.ownerAnswers, 1);
});

// --- the hold (T3): project hA, one daemon; the checks run in order on one open handover, H1.
let A, H1;
const hA = () => (A ??= project('hA'));
const REASON = 'Log in to the fixture site, then press Done';
const HELD_WORDS = (verb, qid) => new RegExp(`browser ${verb}: the owner has the browser \\(${qid}\\); browser wait says when it is back`);
// every new question line in P's live log, in file order
const questionLines = (P) => {
  const dir = path.join(P.run, 'log');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).sort().flatMap((f) => fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l))).filter((l) => l.type === 'question' && l.op === 'new');
};
const statusJson = async (P) => { const s = JSON.parse((await ok(P, ['status', '--json'])).out); assert.deepEqual(validate('status', s), [], JSON.stringify(s)); return s; };
// the control socket, skipping the CLI: the secret and port from state.json
const direct = (P, verb, args = {}) => new Promise((resolve, reject) => {
  const st = JSON.parse(fs.readFileSync(P.state, 'utf8'));
  const body = JSON.stringify({ verb, args });
  const req = http.request({ host: '127.0.0.1', port: st.control_port, method: 'POST', path: '/', timeout: 60000, headers: { host: `127.0.0.1:${st.control_port}`, 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), 'x-devteam-browser': st.control_secret } }, (res) => {
    let b = '';
    res.setEncoding('utf8');
    res.on('data', (c) => { b += c; });
    res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } });
  });
  req.on('timeout', () => req.destroy(new Error('no answer in 60 s')));
  req.on('error', reject);
  req.end(body);
});
const handoverLine = (P, extra = {}) => ({ type: 'question', kind: 'owner-action', class: 'browser-handover', scope: `browser:${P.key}`, question: 'Log in (merged by hand)', choices: [{ label: 'Done' }, { label: "Can't right now" }], ...extra });

test('C1 browser handover asks one owner-action question: class, scope, choices, a preview link by name', chromeOpts, async () => {
  const P = hA();
  await ok(P, ['start']);
  await ok(P, ['open', `${site.origin}/login`]);
  const r = await browser(P, ['handover', '--reason', REASON]);
  assert.equal(r.status, 0, r.err || r.out);
  H1 = qidOf(r);
  assert.ok(H1, r.out);
  const st = JSON.parse(fs.readFileSync(P.state, 'utf8'));
  const line = questionLines(P).find((l) => l.id === H1);
  assert.ok(line, `no question line ${H1}`);
  assert.equal(line.kind, 'owner-action');
  assert.equal(line.class, 'browser-handover');
  assert.equal(line.scope, `browser:${P.key}`);
  assert.equal(line.question, REASON);
  assert.deepEqual(line.choices.map((c) => c.label), ['Done', "Can't right now"]);
  assert.equal(line.stake, 2);
  assert.equal(line.urgency, 2);
  assert.equal(line.default, undefined);
  assert.equal(line.links.length, 1, JSON.stringify(line.links));
  assert.deepEqual(Object.keys(line.links[0]).sort(), ['preview', 'title'], 'a name only: no url, port or token key');
  assert.equal(line.links[0].preview, st.preview);
  const text = JSON.stringify(line);
  assert.ok(!text.includes(st.control_secret), 'the line holds the control secret');
  assert.doesNotMatch(text, new RegExp(`(?<![0-9])${st.view_port}(?![0-9])`), 'the line holds the view port');
  // the site's host (with its port) as its own line, never a path
  const lines = line.context.split('\n');
  assert.ok(lines.includes(`The browser is on 127.0.0.1:${site.port}.`), line.context);
  assert.doesNotMatch(line.context, /\/login/);
  // the Inbox names the class in words
  const d = JSON.parse((await kit(P, ['dashboard-data'])).out);
  assert.equal(d.questions.find((q) => q.id === H1)?.class_name, 'Handing the browser to you for a login');
});

test('C4 while held every agent verb exits 3, status says held, profiles, stop and start run; the daemon refuses a direct call', chromeOpts, async () => {
  const P = hA();
  assert.ok(H1, 'C1 asked the handover');
  for (const args of [['open', `${site.origin}/account`], ['snapshot'], ['click', 'e1'], ['type', 'e1', 'x'], ['press', 'Enter'], ['scroll', 'down'], ['back'], ['tabs'], ['tab', '1'], ['screenshot'], ['forget'], ['forget', '--profile', P.key], ['forget', '--profile', 'other-0123456789ab'], ['type', 'e1', '--stdin']]) {
    const r = await browser(P, args);
    assert.equal(r.status, 3, `browser ${args.join(' ')}: exit ${r.status}: ${r.err || r.out}`);
    assert.match(r.err, HELD_WORDS(args[0], H1), `browser ${args.join(' ')}`);
  }
  assert.equal((await statusJson(P)).held, H1);
  assert.match((await ok(P, ['status'])).out, new RegExp(`^held: ${H1} \\(the owner has the browser\\)$`, 'm'));
  // the daemon refuses on its own, the CLI skipped
  const d = await direct(P, 'snapshot', {});
  assert.equal(d.code, 3, JSON.stringify(d));
  assert.equal(d.out, `the owner has the browser (${H1})`);
  assert.equal((await direct(P, 'tabs', {})).code, 3);
  assert.equal((await direct(P, 'status', { json: true })).code, 0);
  // allowed while held
  await ok(P, ['profiles']);
  await ok(P, ['stop']);
  const off = await statusJson(P);
  assert.equal(off.running, false);
  assert.equal(off.held, H1, 'offline status says held too');
  assert.match((await ok(P, ['status'])).out, new RegExp(`^held: ${H1} \\(the owner has the browser\\)$`, 'm'));
  await ok(P, ['start']);
  assert.equal((await statusJson(P)).held, H1);
  assert.equal((await direct(P, 'snapshot', {})).code, 3, 'a new daemon refuses too');
});

test('C5 no file or restart releases the hold: state.json deleted, the daemon killed, stop then start', chromeOpts, async () => {
  const P = hA();
  assert.ok(H1, 'C1 asked the handover');
  const refusedBoth = async (why) => {
    for (const args of [['snapshot'], ['open', `${site.origin}/account`]]) {
      const r = await browser(P, args);
      assert.equal(r.status, 3, `${why}: browser ${args[0]}: exit ${r.status}: ${r.err || r.out}`);
      assert.match(r.err, HELD_WORDS(args[0], H1), why);
    }
  };
  const pid = JSON.parse(fs.readFileSync(P.state, 'utf8')).daemon_pid;
  fs.rmSync(P.state);
  await refusedBoth('state.json deleted');
  process.kill(pid, 'SIGKILL');
  await refusedBoth('the daemon killed');
  await ok(P, ['stop']);
  await ok(P, ['start']);
  await refusedBoth('stop then start');
  assert.equal((await statusJson(P)).held, H1);
});

test('C10 a second handover while one is open is refused, naming it, and adds no line', chromeOpts, async () => {
  const P = hA();
  assert.ok(H1, 'C1 asked the handover');
  const n0 = questionLines(P).length;
  const r = await browser(P, ['handover', '--reason', 'Log in again']);
  assert.equal(r.status, 1, r.err || r.out);
  assert.match(r.err, new RegExp(`browser handover: ${H1} is already open; wait for it \\(browser wait\\) or withdraw it`));
  const a = await kit(P, ['ask', '--kind', 'owner-action', '--class', 'browser-handover', '--scope', `browser:${P.key}`, '--question', 'x', '--choices', CHOICE_JSON, '--stake', '2', '--urgency', '2']);
  assert.equal(a.status, 1, a.err || a.out);
  assert.match(a.err, new RegExp(H1));
  assert.equal(questionLines(P).length, n0, 'no line is added');
});

test('handover takes --reason alone: non-blank, at most 2000 characters', chromeOpts, async () => {
  const P = hA();
  const n0 = questionLines(P).length;
  for (const args of [[], ['--reason'], ['--reason', '   '], ['--reason='], ['--reason', 'x'.repeat(2001)], ['--reason', '\u{1F600}'.repeat(2001)], ['--reason', 'x', '--default', 'Done'], ['now', '--reason', 'x'], ['--reason', 'x', '--', 'more']]) {
    const r = await browser(P, ['handover', ...args]);
    assert.equal(r.status, 1, `handover ${args.join(' ').slice(0, 40)}: exit ${r.status}: ${r.err || r.out}`);
    assert.match(r.err, /usage: browser handover --reason/, `handover ${args.join(' ').slice(0, 40)}`);
  }
  // 2000 characters counted as code points: 2000 emoji (4000 UTF-16 units) pass the argument check,
  // and are refused only by the open handover
  const cp = await browser(P, ['handover', '--reason', '\u{1F600}'.repeat(2000)]);
  assert.equal(cp.status, 1, cp.err || cp.out);
  assert.match(cp.err, /is already open/, '2000 code points are within the limit');
  assert.equal(questionLines(P).length, n0, 'no line is added');
});

test('RF5 two open handovers: held by the oldest', chromeOpts, async () => {
  const P = hA();
  assert.ok(H1, 'C1 asked the handover');
  const h1At = questionLines(P).find((l) => l.id === H1).at;
  const newer = appendLine(P, handoverLine(P));
  assert.equal((await statusJson(P)).held, H1, 'a newer one merged in: still H1');
  const older = appendLine(P, handoverLine(P, { at: new Date(Date.parse(h1At) - 60000).toISOString() }));
  assert.equal((await statusJson(P)).held, older.id, 'an older one merged in: held by it');
  const r = await browser(P, ['snapshot']);
  assert.equal(r.status, 3);
  assert.match(r.err, HELD_WORDS('snapshot', older.id));
  assert.equal((await direct(P, 'snapshot', {})).out, `the owner has the browser (${older.id})`);
  await withdraw(P, older.id);
  assert.equal((await statusJson(P)).held, H1, 'the older closed: H1 again');
  await withdraw(P, newer.id);
  assert.equal((await statusJson(P)).held, H1);
});

test('C22 another instance\'s handover never holds this browser', chromeOpts, async () => {
  const P = hA();
  assert.ok(H1, 'C1 asked the handover');
  await withdraw(P, H1);
  assert.equal((await statusJson(P)).held, null);
  const other = appendLine(P, handoverLine(P, { scope: 'browser:other-0123456789ab' }));
  await ok(P, ['open', `${site.origin}/account`]);
  await ok(P, ['snapshot']);
  assert.equal((await direct(P, 'snapshot', {})).code, 0);
  assert.equal((await statusJson(P)).held, null);
  assert.match((await ok(P, ['status'])).out, /^held: no$/m);
  await withdraw(P, other.id);
  await new Promise((r) => setTimeout(r, 1500));
  assert.ok(!(readLedger(P)?.resets ?? []).some((e) => e.qid === other.id), 'its close enters this ledger');
});
