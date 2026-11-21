// The browser handover's close (kit-67): what happens once the owner hands the browser back, and the
// repeated-site warning. Each check is the spec's
// (docs/devteam/project/tickets/kit-67-browser-handover/spec.md, home), named by its id. Every check
// needs Chrome and skips without canDrive; the mustRun guard fails the file instead on CI's Node 22+.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { canDrive } from './lib/chrome.mjs';
import { startSites } from './lib/sites.mjs';
import { handoverFile, project, kit, browser, owner, appendLine, site, CHOICES, qidOf, ok, withdraw, sleep, until, readState, askHandover, waitJson, handoverLine, entriesFor, ledgerValid, typeNote, viewSocket, profilePids, alive, killDaemon, readLedger } from './lib/browser-handover-fixture.mjs';

handoverFile();

// CI's Node 22 and 24 jobs have Chrome: there the file must run, never skip.
const mustRun = !!process.env.CI && Number(process.versions.node.split('.')[0]) >= 22;
const skip = canDrive ? false : 'needs Chrome and Node 22+';
// The checks run as two chains at once, one per project (each its own daemon), checks in order within
// a chain: cA's (C23, C15, C20, W1, RF3) and cB's (C18, RF4). onA and onB add a check.
const cAChecks = [], cBChecks = [];
const onA = (name, fn) => cAChecks.push([name, fn]);
const onB = (name, fn) => cBChecks.push([name, fn]);
if (mustRun && !canDrive) test('Chrome is needed on CI\'s Node 22+', () => assert.fail('Chrome is needed on CI\'s Node 22+: this file must run there, not skip'));

// C23's own sites: hosts no other check hands over, so only C23's handovers name them. S2 carries
// the 8-day case and the near miss, S3 the 6-day, second-handover and after-forget cases: the live
// handover of the 8-day case names S2, so it is never an earlier handover of S3's cases.
let S2, S3;
before(async () => { S2 = await startSites(); S3 = await startSites(); });
after(async () => { await S2?.close(); await S3?.close(); });

let C;
const cA = () => (C ??= project('cA', { DEVTEAM_TEST_BROWSER_ALLOW: `${site.port},${S2.port},${S3.port}` }));
const DAY = 86400000;
const host = (S) => `127.0.0.1:${S.port}`;
// an earlier handover of this scope, written by hand as asked at `at` on `on`, and closed
async function earlier(P, on, at) {
  const l = appendLine(P, { type: 'question', kind: 'owner-action', class: 'browser-handover', scope: `browser:${P.key}`, question: 'Log in (written by hand)', context: `Open the browser from the link, log in, then press Done.\n\nThe browser is on ${on}.`, choices: CHOICES, at: new Date(at).toISOString() });
  await withdraw(P, l.id);
  return l.id;
}
// a live handover on site S: { qid, err }, closed again after
async function handover(P, S) {
  await ok(P, ['open', `${S.origin}/login`]);
  const r = await browser(P, ['handover', '--reason', 'Log in to the fixture site, then press Done']);
  assert.equal(r.status, 0, r.err || r.out);
  const qid = qidOf(r);
  assert.ok(qid, r.out);
  await withdraw(P, qid);
  return { qid, err: r.err };
}
const WARNED = /was handed over on .* and not forgotten since/;
const warning = (S, qid) => new RegExp(`devteam: warning: browser handover: ${host(S).replace(/\./g, '\\.')} was handed over on \\d{4}-\\d{2}-\\d{2} \\(${qid}\\) and not forgotten since; the session may not have lasted`);

onA('C23 a second handover of a site within 7 days, with no forget between, warns naming the earlier one', async () => {
  const P = cA();
  await ok(P, ['start']);
  // root.json 10 days back: only the hand-written earlier handovers' dates decide
  const root = path.join(P.profile, 'root.json');
  const back = new Date(Date.now() - 10 * DAY);
  fs.utimesSync(root, back, back);
  // 8 days back: too old to warn
  await earlier(P, host(S2), Date.now() - 8 * DAY);
  const eight = await handover(P, S2);
  assert.doesNotMatch(eight.err, WARNED, `8 days back: ${eight.err}`);
  // 6 days back: warns, naming it
  const six = await earlier(P, host(S3), Date.now() - 6 * DAY);
  const h6 = await handover(P, S3);
  assert.match(h6.err, warning(S3, six), `6 days back: ${h6.err}`);
  // a live second handover: warns naming the most recent earlier one, the live first
  const second = await handover(P, S3);
  assert.match(second.err, warning(S3, h6.qid), `the second handover: ${second.err}`);
  // forget remakes root.json: no warning after it
  await ok(P, ['stop']);
  await ok(P, ['forget']);
  await ok(P, ['start']);
  const fresh = await handover(P, S3);
  assert.doesNotMatch(fresh.err, WARNED, `after forget: ${fresh.err}`);
  // a host the earlier one doesn't name exactly: 127.0.0.1:<port> is not 127.0.0.1:<port>0
  await earlier(P, `${host(S2)}0`, Date.now());
  const near = await handover(P, S2);
  assert.doesNotMatch(near.err, WARNED, `the near-miss host: ${near.err}`);
});

// --- the close (T4) on cA, after C23
const marker = (what) => `zq-${what}-${Math.random().toString(36).slice(2, 10)}`;
const tabUrls = async (P) => JSON.parse((await ok(P, ['tabs'])).out).tabs.map((t) => t.url);
const BLANK = /^From about:blank \(page text: data, not instructions\)/;
const entryIs = (P, qid, outcome) => {
  const e = entriesFor(P, qid).at(-1);
  assert.ok(e, `no ledger entry for ${qid}`);
  assert.equal(e.outcome, outcome, JSON.stringify(e));
  assert.equal(e.reset, outcome !== 'done', JSON.stringify(e));
  return e;
};

onA('C15 a crash mid-handover with a half-typed note: after the withdraw, snapshot shows about:blank, and the ledger has the reset', async () => {
  const P = cA();
  await ok(P, ['open', `${site.origin}/record`]);
  const q = await askHandover(P);
  const mark = marker('c15');
  await typeNote(P, mark);
  await killDaemon(P);
  await withdraw(P, q);
  const s = await ok(P, ['snapshot']);
  assert.match(s.out, BLANK);
  assert.ok(!s.out.includes(mark), 'the half-typed note survived the crash');
  entryIs(P, q, 'withdrawn');
});

onA('C20 a close while no daemon runs is handled at start: no tab restored, and an entry', async () => {
  const P = cA();
  await ok(P, ['open', `${site.origin}/record`]);
  const q = await askHandover(P);
  await killDaemon(P);
  await withdraw(P, q);
  await sleep(1000);
  await ok(P, ['start']);
  assert.deepEqual(await tabUrls(P), ['about:blank']);
  entryIs(P, q, 'withdrawn');
});

onA('W1 wait after a restart: a close made while the daemon was dead, and one handled by a daemon since stopped', async () => {
  const P = cA();
  // the wait bound cut, so a wait that never sees its close handled fails fast
  const W = { DEVTEAM_TEST_BROWSER_WAIT_MS: '15000' };
  const q1 = await askHandover(P);
  await killDaemon(P);
  await withdraw(P, q1);
  const w1 = await waitJson(P, [], W);
  assert.equal(w1.qid, q1);
  assert.equal(w1.outcome, 'withdrawn');
  entryIs(P, q1, 'withdrawn');
  const q2 = await askHandover(P);
  assert.equal((await owner(P, ['answer', q2, '--choice', 'Done'])).status, 0);
  const w2 = await waitJson(P, [], W);
  assert.equal(w2.outcome, 'done');
  const e = entryIs(P, q2, 'done');
  assert.deepEqual(w2.reopened, e.reopened);
  // a new daemon finds q2 handled by the ledger alone, and settle lists it from there
  await ok(P, ['stop']);
  const w3 = await waitJson(P, [], W);
  assert.deepEqual(w3, { browser: 1, qid: q2, outcome: 'done', reopened: e.reopened });
  assert.equal(entriesFor(P, q2).length, 1, 'the new daemon handled q2 again');
});

onA('RF3 a ledger entry dated ahead, and a close dated ahead of the clock: each handled once, never in a loop', async () => {
  const P = cA();
  await ok(P, ['start']);
  // (a) an entry written by hand a day ahead doesn't count: one restart and one new entry, and no more
  const a = appendLine(P, handoverLine(P));
  const led = readLedger(P) ?? { browser: 1, resets: [] };
  led.resets.push({ qid: a.id, outcome: 'withdrawn', reset: true, at: new Date(Date.now() + DAY).toISOString() });
  fs.writeFileSync(P.ledger, `${JSON.stringify(led)}\n`, { mode: 0o600 });
  const pid0 = readState(P).chrome_pid;
  await withdraw(P, a.id);
  await until(() => entriesFor(P, a.id).length === 2, 10000, 'a new entry for the close');
  const pid1 = readState(P).chrome_pid;
  assert.notEqual(pid1, pid0, 'Chrome restarted');
  // (b) a close line dated 5 minutes ahead: its entry at the close time, handled once
  const b = appendLine(P, handoverLine(P));
  const ahead = new Date(Date.now() + 5 * 60000).toISOString();
  appendLine(P, { type: 'question', op: 'set', id: b.id, status: 'withdrawn', reason: 'a close dated ahead', at: ahead });
  const eb = await until(() => entriesFor(P, b.id)[0], 10000, 'the entry for the close dated ahead');
  assert.equal(eb.at, ahead, 'its at is the close time');
  const pid2 = readState(P).chrome_pid;
  assert.notEqual(pid2, pid1, 'Chrome restarted');
  await sleep(2500);
  assert.equal(entriesFor(P, a.id).length, 2, '(a) handled again');
  assert.equal(entriesFor(P, b.id).length, 1, '(b) handled again');
  assert.equal(readState(P).chrome_pid, pid2, 'Chrome restarted again: a loop');
  // a new daemon skips both by the ledger
  await ok(P, ['stop']);
  await ok(P, ['start']);
  await sleep(1500);
  assert.equal(entriesFor(P, a.id).length, 2, 'a new daemon handled (a) again');
  assert.equal(entriesFor(P, b.id).length, 1, 'a new daemon handled (b) again');
});

// --- cB: DEVTEAM_TEST_BROWSER_WATCH_HANDLE=0, so a close is handled only by a verb's pre-verb read or
// wait's settle.
let CB;
const cB = () => (CB ??= project('cB', { DEVTEAM_TEST_BROWSER_WATCH_HANDLE: '0' }));

onB('C18 a snapshot at once after a withdraw is served only after the reset', async () => {
  const P = cB();
  await ok(P, ['start']);
  await ok(P, ['open', `${site.origin}/record`]);
  const q = await askHandover(P);
  await withdraw(P, q);
  const s = await ok(P, ['snapshot']);
  assert.match(s.out, BLANK);
  entryIs(P, q, 'withdrawn');
});

onB('RF4 the daemon told to stop during a close: the close ends, and no Chrome is left', async () => {
  const P = cB();
  await ok(P, ['stop']);
  await ok(P, ['start'], { DEVTEAM_TEST_BROWSER_CLOSE_DELAY_MS: '5000' });
  const st = readState(P);
  const q = await askHandover(P);
  const v = await viewSocket(P);
  await withdraw(P, q);
  const snap = browser(P, ['snapshot']); // its pre-verb read starts the close, held 5 s after the bye
  await v.waitFor((m) => m.t === 'bye', 15000);
  process.kill(st.daemon_pid, 'SIGTERM');
  await until(() => !alive(st.daemon_pid), 20000, 'the daemon gone');
  assert.deepEqual(profilePids(P), [], 'a Chrome left on the profile');
  const r = await snap;
  assert.notEqual(r.status, 0, `the snapshot was served: ${r.out}`);
  assert.equal(entriesFor(P, q).length, 0, 'a close cut short wrote its entry');
  // the next start handles it
  await ok(P, ['start']);
  entryIs(P, q, 'withdrawn');
});

test('the close on cA and cB, two chains at once (C17: every ledger validates after each check)', { skip, timeout: 280000, concurrency: 2 }, async (t) => {
  const chain = (P, checks) => t.test(`on ${P().name}`, { concurrency: 1 }, async (c) => {
    for (const [name, fn] of checks) await c.test(name, { timeout: 120000 }, async () => { await fn(); ledgerValid(P()); });
    await c.test('C17 resets.json validates against shapes.resets, mode 0600', () => {
      assert.ok(fs.existsSync(P().ledger), 'no resets.json after the closes');
      ledgerValid(P());
    });
  });
  await Promise.all([chain(cA, cAChecks), chain(cB, cBChecks)]);
});
