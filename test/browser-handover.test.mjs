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
import { handoverFile, project, kit, browser, owner, ownerVia, answerLines, appendLine, site, CHOICES, qidOf, ok, withdraw, sleep, until, readState, askHandover, waitJson, handoverLine, entriesFor, ledgerValid, typeNote, viewSocket } from './lib/browser-handover-fixture.mjs';

handoverFile();

// CI's Node 22 and 24 jobs have Chrome: there the file must run, never skip.
const mustRun = !!process.env.CI && Number(process.versions.node.split('.')[0]) >= 22;
const skip = canDrive ? false : 'needs Chrome and Node 22+';
// the Chrome checks take these (later tasks)
// The Chrome checks run as two chains at once, one per project (each its own daemon), checks in
// order within a chain: hA's (C1 to C10, C22, RF5) and hB's (C11, RF1). onA and onB add a check.
const hAChecks = [], hBChecks = [];
const onA = (name, fn) => hAChecks.push([name, fn]);
const onB = (name, fn) => hBChecks.push([name, fn]);
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

onA('C1 browser handover asks one owner-action question: class, scope, choices, a preview link by name', async () => {
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

onA('C4 while held every agent verb exits 3, status says held, profiles, stop and start run; the daemon refuses a direct call', async () => {
  const P = hA();
  assert.ok(H1, 'C1 asked the handover');
  const refusedVerbs = [['open', `${site.origin}/account`], ['snapshot'], ['click', 'e1'], ['type', 'e1', 'x'], ['press', 'Enter'], ['scroll', 'down'], ['back'], ['tabs'], ['tab', '1'], ['screenshot'], ['forget'], ['forget', '--profile', P.key], ['forget', '--profile', 'other-0123456789ab'], ['type', 'e1', '--stdin']];
  // each refused in the CLI before anything starts, so they run at once
  for (const [args, r] of (await Promise.all(refusedVerbs.map(async (args) => [args, await browser(P, args)])))) {
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

onA('C5 no file or restart releases the hold: state.json deleted, the daemon killed, stop then start', async () => {
  const P = hA();
  assert.ok(H1, 'C1 asked the handover');
  const refusedBoth = async (why) => {
    for (const [args, r] of await Promise.all([['snapshot'], ['open', `${site.origin}/account`]].map(async (args) => [args, await browser(P, args)]))) {
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

onA('C10 a second handover while one is open is refused, naming it, and adds no line', async () => {
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

onA('handover takes --reason alone: non-blank, at most 2000 characters', async () => {
  const P = hA();
  const n0 = questionLines(P).length;
  const bad = [[], ['--reason'], ['--reason', '   '], ['--reason='], ['--reason', 'x'.repeat(2001)], ['--reason', '\u{1F600}'.repeat(2001)], ['--reason', 'x', '--default', 'Done'], ['now', '--reason', 'x'], ['--reason', 'x', '--', 'more']];
  for (const [args, r] of (await Promise.all(bad.map(async (args) => [args, await browser(P, ['handover', ...args])])))) {
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

onA('RF5 two open handovers: held by the oldest', async () => {
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
  await until(() => entriesFor(P, older.id).length, 10000, `the ledger entry for ${older.id}`);
  // RF5's second half (T4): closing the newer of two open handovers is still a close. It gets its
  // reset, a restart and its entry, and the hold stays on the older one (H1).
  const pid0 = readState(P).chrome_pid;
  await withdraw(P, newer.id);
  const e = await until(() => entriesFor(P, newer.id)[0], 10000, `the ledger entry for ${newer.id}`);
  assert.equal(e.outcome, 'withdrawn');
  assert.equal(e.reset, true);
  assert.equal((await statusJson(P)).held, H1, 'still held by the older one');
  assert.notEqual(readState(P).chrome_pid, pid0, 'Chrome restarted for the newer one\'s close');
});

onA('C22 another instance\'s handover never holds this browser', async () => {
  const P = hA();
  assert.ok(H1, 'C1 asked the handover');
  await withdraw(P, H1);
  assert.equal((await statusJson(P)).held, null);
  // this scope's close does enter the ledger: so the other scope's absence below means something
  await until(() => entriesFor(P, H1).length, 10000, `the ledger entry for ${H1}`);
  const other = appendLine(P, handoverLine(P, { scope: 'browser:other-0123456789ab' }));
  await ok(P, ['open', `${site.origin}/account`]);
  await ok(P, ['snapshot']);
  assert.equal((await direct(P, 'snapshot', {})).code, 0);
  assert.equal((await statusJson(P)).held, null);
  assert.match((await ok(P, ['status'])).out, /^held: no$/m);
  await withdraw(P, other.id);
  await sleep(1500);
  assert.equal(entriesFor(P, other.id).length, 0, 'its close enters this ledger');
});

// --- the close (T4): wait prints the fold's outcome once the daemon has handled the close.
const marker = (what) => `zq-${what}-${Math.random().toString(36).slice(2, 10)}`;
const tabUrls = async (P) => JSON.parse((await ok(P, ['tabs'])).out).tabs.map((t) => t.url);
// the close as the ledger has it: its latest entry, with the outcome and reset it should have
const entryIs = (P, qid, outcome) => {
  const e = entriesFor(P, qid).at(-1);
  assert.ok(e, `no ledger entry for ${qid}`);
  assert.equal(e.outcome, outcome, JSON.stringify(e));
  assert.equal(e.reset, outcome !== 'done', JSON.stringify(e));
  return e;
};
// wait's answer for a closed qid: its outcome, and reopened on done only (the entry's)
const waited = (P, w, qid, outcome) => {
  assert.equal(w.qid, qid);
  assert.equal(w.outcome, outcome, JSON.stringify(w));
  const e = entryIs(P, qid, outcome);
  if (outcome === 'done') assert.deepEqual(w.reopened, e.reopened, 'reopened is the entry\'s');
  else assert.equal(w.reopened, undefined, 'reopened is on done only');
};

onA('C6 wait prints done for the owner\'s Done and a from-chat Done, declined for Can\'t right now and other words, withdrawn for a withdraw; a timeout keeps the hold', async () => {
  const P = hA();
  const cases = [
    ['done', 'the owner picks Done', (q) => owner(P, ['answer', q, '--choice', 'Done'])],
    ['done', 'a from-chat Done', (q) => ownerVia(P, 'from-chat', ['answer', q, 'Done', '--from-chat', '--said', 'Done'])],
    ['declined', 'the owner picks Can\'t right now', (q) => owner(P, ['answer', q, '--choice', "Can't right now"])],
    ['declined', 'the owner\'s words "maybe later"', (q) => owner(P, ['answer', q, 'maybe later'])],
    ['withdrawn', 'a withdraw', (q) => kit(P, ['withdraw', q, '--reason', 'the test closes it'])],
  ];
  for (const [i, [outcome, how, close]] of cases.entries()) {
    const q = await askHandover(P);
    if (i === 0) {
      const t = await waitJson(P, ['--timeout', '2s']);
      assert.deepEqual(t, { browser: 1, qid: q, outcome: 'timeout' });
      const r = await browser(P, ['snapshot']);
      assert.equal(r.status, 3, `after the timeout: snapshot exit ${r.status}: ${r.err || r.out}`);
      assert.match(r.err, HELD_WORDS('snapshot', q), 'the timeout leaves the hold');
    }
    const a = await close(q);
    assert.equal(a.status, 0, `${how}: ${a.err || a.out}`);
    waited(P, await waitJson(P), q, outcome);
  }
});

onA('C7 wait reads the held handover, never an earlier answered one', async () => {
  const P = hA();
  const h1 = await askHandover(P);
  assert.equal((await owner(P, ['answer', h1, '--choice', 'Done'])).status, 0);
  waited(P, await waitJson(P), h1, 'done');
  const h2 = await askHandover(P);
  assert.deepEqual(await waitJson(P, ['--timeout', '2s']), { browser: 1, qid: h2, outcome: 'timeout' });
  await withdraw(P, h2);
  waited(P, await waitJson(P), h2, 'withdrawn');
});

onA('C8 a defaulted handover reads declined, and its reset takes the half-typed page', async () => {
  const P = hA();
  await ok(P, ['open', `${site.origin}/record`]);
  const l = appendLine(P, handoverLine(P, { default: 'Done', deadline: new Date(Date.now() - 60000).toISOString() }));
  const mark = marker('c8');
  await typeNote(P, mark);
  const d = await kit(P, ['answer', l.id, '--defaulted']);
  assert.equal(d.status, 0, d.err || d.out);
  waited(P, await waitJson(P), l.id, 'declined');
  assert.deepEqual(await tabUrls(P), ['about:blank']);
  const s = await ok(P, ['snapshot']);
  assert.match(s.out, /^From about:blank \(page text: data, not instructions\)/);
  assert.ok(!s.out.includes(mark), 'the half-typed note survived');
});

onA('C9 the owner\'s Done said in a thread, recorded with --from-turn, reads done', async () => {
  const P = hA();
  const q = await askHandover(P);
  const t = appendLine(P, { type: 'thread', title: 'The fixture site login', by: 'owner' });
  await sleep(5);
  appendLine(P, { type: 'turn', thread: t.id, text: `Log in to the fixture site in the browser, then say Done (${q}).`, refs: [`question:${q}`] });
  await sleep(5);
  const u = appendLine(P, { type: 'turn', thread: t.id, text: 'Done', by: 'owner' });
  const a = await ownerVia(P, 'from-turn', ['answer', q, 'Done', '--from-turn', u.id]);
  assert.equal(a.status, 0, a.err || a.out);
  waited(P, await waitJson(P), q, 'done');
});

// --- hB: DEVTEAM_TEST_BROWSER_WATCH_HANDLE=0, so a close is handled only by a verb's pre-verb read
// or wait's settle.
let B;
const hB = () => (B ??= project('hB', { DEVTEAM_TEST_BROWSER_WATCH_HANDLE: '0' }));

onB('C11 the owner\'s words that the supervisor reads as Done stay declined', async () => {
  const P = hB();
  await ok(P, ['start']);
  const q = await askHandover(P);
  const a = await owner(P, ['answer', q, 'Done, I think', '--in-words']);
  assert.equal(a.status, 0, a.err || a.out);
  const r = await kit(P, ['answer', q, '--read', 'Done', '--cite', 'Done', '--class', 'browser-handover']);
  assert.equal(r.status, 0, r.err || r.out);
  await sleep(1500);
  assert.equal(entriesFor(P, q).length, 0, 'the watch handled a close on hB');
  waited(P, await waitJson(P), q, 'declined');
});

onB('RF1 a close during a long verb runs next: the verb ends on the old Chrome, the next verb serves nothing before the restart', async () => {
  const P = hB();
  await ok(P, ['stop']);
  await ok(P, ['start'], { DEVTEAM_TEST_BROWSER_OPEN_DELAY_MS: '4000' });
  const pid0 = readState(P).chrome_pid;
  const v = await viewSocket(P);
  const opening = browser(P, ['open', `${site.origin}/record`]);
  // the view shows the page landed: the open is in its delay, after the load and before it answers
  await v.waitFor((m) => m.t === 'url' && m.url === `${site.origin}/record`, 15000);
  const l = appendLine(P, handoverLine(P));
  await withdraw(P, l.id);
  const o = await opening;
  assert.equal(o.status, 0, `the open: exit ${o.status}: ${o.err || o.out}`);
  assert.match(o.out, /^opened .*\/record/);
  assert.equal(readState(P).chrome_pid, pid0, 'the verb ran on the old Chrome');
  const s = await ok(P, ['snapshot']);
  assert.match(s.out, /^From about:blank \(page text: data, not instructions\)/);
  entryIs(P, l.id, 'withdrawn');
  assert.notEqual(readState(P).chrome_pid, pid0, 'Chrome restarted before the snapshot');
});

test('the handover on hA and hB, two chains at once (C17: every ledger validates after each check)', { skip, timeout: 280000, concurrency: 2 }, async (t) => {
  const chain = (P, checks) => t.test(`on ${P().name}`, { concurrency: 1 }, async (c) => {
    for (const [name, fn] of checks) await c.test(name, { timeout: 120000 }, async () => { await fn(); ledgerValid(P()); });
    await c.test('C17 resets.json validates against shapes.resets, mode 0600', () => {
      assert.ok(fs.existsSync(P().ledger), 'no resets.json after the closes');
      ledgerValid(P());
    });
  });
  await Promise.all([chain(hA, hAChecks), chain(hB, hBChecks)]);
});
