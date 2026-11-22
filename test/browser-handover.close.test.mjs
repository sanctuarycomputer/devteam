// The browser handover's close (kit-67): what happens once the owner hands the browser back, and the
// repeated-site warning. Each check is the spec's
// (docs/devteam/project/tickets/kit-67-browser-handover/spec.md, home), named by its id. Every check
// needs Chrome and skips without canDrive; the mustRun guard fails the file instead on CI's Node 22+.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { canDrive } from './lib/chrome.mjs';
import { startSites } from './lib/sites.mjs';
import { handoverFile, project, kit, browser, owner, appendLine, site, CHOICES, qidOf, ok, withdraw, sleep, until, readState, askHandover, waitJson, handoverLine, entriesFor, ledgerValid, typeNote, viewSocket, profilePids, alive, killDaemon, readLedger, answerLines, ownerLogIn, scanLoop, codeOnDisk } from './lib/browser-handover-fixture.mjs';

handoverFile();

// CI's Node 22 and 24 jobs have Chrome: there the file must run, never skip.
const mustRun = !!process.env.CI && Number(process.versions.node.split('.')[0]) >= 22;
const skip = canDrive ? false : 'needs Chrome and Node 22+';
// The checks run as four chains at once, one per project (each its own daemon), checks in order within
// a chain: cA's (C23, C15, C20, W1, C21, RF3), cB's (C18, C19, PC1, RF4, T4-1, T4-3, PC3, T4-2), cC's (C24, T6-3, RF2)
// and cD's (C12, C13, C14, C16). onA, onB, onC and onD add a check.
const cAChecks = [], cBChecks = [], cCChecks = [], cDChecks = [];
const onA = (name, fn) => cAChecks.push([name, fn]);
const onB = (name, fn) => cBChecks.push([name, fn]);
const onC = (name, fn) => cCChecks.push([name, fn]);
const onD = (name, fn) => cDChecks.push([name, fn]);
if (mustRun && !canDrive) test('Chrome is needed on CI\'s Node 22+', () => assert.fail('Chrome is needed on CI\'s Node 22+: this file must run there, not skip'));

// C23's own sites: hosts no other check hands over, so only C23's handovers name them. S2 carries
// the 8-day case and the near miss, S3 the 6-day, second-handover and after-forget cases: the live
// handover of the 8-day case names S2, so it is never an earlier handover of S3's cases.
let S2, S3, ticker;
before(async () => {
  S2 = await startSites();
  S3 = await startSites();
  // a page that repaints all the time, so the screencast has frames to send whenever it is allowed to
  ticker = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><title>ticker</title><p id="n">0</p><script>let i = 0; setInterval(() => { document.getElementById("n").textContent = ++i; document.body.style.background = i % 2 ? "#fff" : "#eee"; }, 40);</script>'); });
  await new Promise((r) => ticker.listen(0, '127.0.0.1', r));
});
after(async () => { await S2?.close(); await S3?.close(); await new Promise((r) => (ticker ? ticker.close(r) : r())); });

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

// --- the reopen and the secrets (T5) on cD: a project of their own (no hooks), a chain beside cA's and
// cB's, so the file's longest chain stays short
let CD;
const cD = () => (CD ??= project('cD'));
const SIGNED = 'Signed in as owner';
// the site's sign-in POSTs by path (other chains POST /events to the same site meanwhile)
const signInPosts = () => { const p = site.posts().paths; return { login: p['/login'] ?? 0, twofa: p['/2fa'] ?? 0 }; };
// The close after a login, with C12's scan: the code shown on disk first; the scan running from before
// the answer (close: the owner's Done or Can't right now, or the supervisor's withdraw); no secret in
// any scan from 2 s after the answer on, and none after the first clean one, through wait and once
// after. The answer's time is its log line's at. { w, ms }: wait's output, and answer to first clean.
async function closeAndScan(P, q, close, label) {
  await codeOnDisk(P, site.code);
  const loop = scanLoop(P, [site.password, site.code]);
  let w, answerAt, clean;
  try {
    await close();
    const l = logAt(P, q);
    answerAt = Date.parse(l);
    assert.ok(Number.isFinite(answerAt), `the close line's at: ${l}`);
    const end = Date.now() + 15000;
    while (loop.firstCleanAfter(answerAt) === null) {
      if (Date.now() > end) assert.fail(`${label}: no clean scan in 15 s after the answer; the last found ${JSON.stringify(loop.scans.at(-1)?.found)}`);
      await sleep(50);
    }
    clean = loop.firstCleanAfter(answerAt);
    w = await waitJson(P);
  } finally { await loop.stop(); }
  const ms = clean - answerAt;
  let load = '?';
  try { load = fs.readFileSync('/proc/loadavg', 'utf8').split(' ').slice(0, 3).join(' '); } catch {}
  const took = loop.scans.map((s) => s.ms);
  const first = loop.scans.find((s) => s.at === clean);
  console.log(`# kit-67 ${label}: answer to first clean scan ${ms} ms (by its end ${clean + first.ms - answerAt} ms; ${loop.scans.length} scans, each ${Math.min(...took)}-${Math.max(...took)} ms; load ${load})`);
  const late = loop.scans.filter((s) => s.found.length && (s.at >= answerAt + 2000 || s.at >= clean));
  assert.deepEqual(late.map((s) => ({ after: s.at - answerAt, found: s.found })), [], `${label}: a secret on disk 2 s after the answer, or after a clean scan`);
  return { w, ms };
}
// The at of the line that closed question q: its answer (an owner line) or its status set line.
const logAt = (P, q) => [...answerLines(P), ...closeLines(P)].filter((l) => l.id === q).map((l) => l.at).sort().pop();
const closeLines = (P) => {
  const dir = path.join(P.run, 'log');
  return fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).flatMap((f) => fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter(Boolean).map((x) => { try { return JSON.parse(x); } catch { return {}; } }))
    .filter((l) => l.type === 'question' && l.op === 'set' && ['withdrawn', 'defaulted'].includes(l.status));
};

onD('C12 a login over the view, then Done: the password and code leave the disk within 2 s, and the last GET (/account) comes back signed in', async () => {
  const P = cD();
  await ok(P, ['open', `${site.origin}/login`]);
  const q = await askHandover(P);
  const v = await ownerLogIn(P, { to: `${site.origin}/account` });
  const { w } = await closeAndScan(P, q, async () => { const a = await owner(P, ['answer', q, '--choice', 'Done']); assert.equal(a.status, 0, a.err || a.out); }, 'C12');
  v.close();
  assert.deepEqual([w.qid, w.outcome, w.reopened], [q, 'done', [`${site.origin}/account`]]);
  const s = await ok(P, ['snapshot']);
  assert.ok(s.out.includes(SIGNED), `the page reopened isn't signed in: ${s.out.slice(0, 300)}`);
  assert.deepEqual(await tabUrls(P), [`${site.origin}/account`]);
  const e = entryIs(P, q, 'done');
  assert.deepEqual(e.reopened, w.reopened);
});

onD('C13 the 200-page variant: the form page (/2fa?variant=•••) is the last GET, reopened signed in, and no POST replayed', async () => {
  const P = cD();
  await ok(P, ['open', `${site.origin}/login?variant=page`]);
  const q = await askHandover(P);
  const v = await ownerLogIn(P, { to: `${site.origin}/2fa` });
  let posts;
  const { w } = await closeAndScan(P, q, async () => {
    posts = signInPosts();
    const a = await owner(P, ['answer', q, '--choice', 'Done']);
    assert.equal(a.status, 0, a.err || a.out);
  }, 'C13');
  v.close();
  assert.deepEqual([w.qid, w.outcome, w.reopened], [q, 'done', [`${site.origin}/2fa?variant=•••`]]);
  assert.deepEqual(signInPosts(), posts, 'a POST was replayed');
  const s = await ok(P, ['snapshot']);
  assert.ok(s.out.includes(SIGNED), `the form page reopened isn't signed in: ${s.out.slice(0, 300)}`);
  assert.deepEqual(await tabUrls(P), [`${site.origin}/2fa?variant=•••`]);
  assert.deepEqual(entryIs(P, q, 'done').reopened, w.reopened);
});

onD('C14 declined and withdrawn after a login: the secrets leave the disk, no tab is kept, and the session-only cookie outlives the restart', async () => {
  const P = cD();
  for (const [label, close, outcome] of [
    ['C14 declined', (q) => async () => { const a = await owner(P, ['answer', q, '--choice', "Can't right now"]); assert.equal(a.status, 0, a.err || a.out); }, 'declined'],
    ['C14 withdrawn', (q) => () => withdraw(P, q), 'withdrawn'],
  ]) {
    await ok(P, ['open', `${site.origin}/login`]);
    const q = await askHandover(P);
    const v = await ownerLogIn(P, { to: `${site.origin}/account` });
    const { w } = await closeAndScan(P, q, close(q), label);
    v.close();
    assert.deepEqual([w.qid, w.outcome, w.reopened], [q, outcome, undefined], label);
    assert.deepEqual(await tabUrls(P), ['about:blank'], label);
    entryIs(P, q, outcome);
    await ok(P, ['open', `${site.origin}/account`]);
    const s = await ok(P, ['snapshot']);
    assert.ok(s.out.includes(SIGNED), `${label}: the session was lost: ${s.out.slice(0, 300)}`);
  }
});

onD('C16 a daemon killed mid-handover: wait brings it and the view back under the same name, and Done reopens the page by GET', async () => {
  const P = cD();
  await ok(P, ['open', `${site.origin}/login`]);
  const q = await askHandover(P);
  const v = await ownerLogIn(P, { to: `${site.origin}/account` });
  v.close();
  const st0 = readState(P);
  await killDaemon(P);
  const t = await waitJson(P, ['--timeout', '3s']);
  assert.deepEqual(t, { browser: 1, qid: q, outcome: 'timeout' });
  const st1 = readState(P);
  assert.ok(st1 && st1.daemon_pid !== st0.daemon_pid && alive(st1.daemon_pid), 'wait did not start the daemon again');
  assert.equal(st1.preview, st0.preview, 'the preview name changed');
  // still held: the owner opens the account page in the view, signed in from before the kill
  const v2 = await viewSocket(P);
  assert.equal(v2.status, 101, 'the view port does not answer');
  await v2.waitFor((m) => m.t === 'frame', 10000);
  const from = v2.msgs.length;
  v2.send({ t: 'nav', url: `${site.origin}/account` });
  await v2.c.wait((m) => m.t === 'url' && m.url === `${site.origin}/account`, 15000, from);
  await sleep(300);
  const a = await owner(P, ['answer', q, '--choice', 'Done']);
  assert.equal(a.status, 0, a.err || a.out);
  const w = await waitJson(P);
  v2.close();
  assert.deepEqual([w.qid, w.outcome, w.reopened], [q, 'done', [`${site.origin}/account`]]);
  assert.deepEqual(entryIs(P, q, 'done').reopened, w.reopened);
  const s = await ok(P, ['snapshot']);
  assert.ok(s.out.includes(SIGNED), `the page reopened isn't signed in: ${s.out.slice(0, 300)}`);
});

// --- the view (T6)
// A socket that became the viewer (its first held came; a socket the old one's close hasn't freed yet
// is told bye, and tried again).
async function nextViewer(P) {
  return until(async () => {
    const x = await viewSocket(P);
    const m = await x.waitFor((o) => o.t === 'held' || o.t === 'bye', 10000);
    if (m.t === 'held') return x;
    x.close();
    return null;
  }, 15000, 'the view free for a new socket');
}
const landed = (text) => site.events().some((e) => String(e.value).includes(text));
const framesIn = (msgs) => msgs.filter((m) => m.t === 'frame').length;
const BACK = 'The supervisor has the browser again.';
// A socket opened while a close is pending: it pastes at once, and is refused with bye. Never a frame,
// never a hold. Returns the pasted text, for the check that it never landed.
async function refusedInGap(P, what) {
  const x = await viewSocket(P);
  const late = marker(what);
  x.paste(late);
  const m = await x.waitFor((o) => o.t === 'bye', 10000);
  assert.equal(m.why, BACK, `${what}: the refusal's words`);
  await sleep(500);
  assert.equal(framesIn(x.msgs), 0, `${what}: a socket in the gap was sent a frame`);
  assert.ok(!x.msgs.some((o) => o.t === 'held' || o.t === 'url'), `${what}: a socket in the gap was served: ${JSON.stringify(x.msgs.map((o) => o.t))}`);
  x.close();
  return late;
}
// A new viewer after a failed or unfinished close: its frames are of a fresh about:blank, never the old page.
async function freshViewer(P) {
  const x = await nextViewer(P);
  await x.waitFor((o) => o.t === 'url', 5000);
  assert.deepEqual([...new Set(x.msgs.filter((o) => o.t === 'url').map((o) => o.url))], ['about:blank'], 'a new viewer saw the old page');
  await x.waitFor((o) => o.t === 'frame', 10000);
  assert.deepEqual([...new Set(x.msgs.filter((o) => o.t === 'url').map((o) => o.url))], ['about:blank'], 'a new viewer saw the old page');
  x.close();
}
// The page is in Chrome's session files, so a start that failed to clear them would bring it back.
const sessionHolds = (P, text) => until(() => {
  const dir = path.join(P.profile, 'Default', 'Sessions');
  let names = [];
  try { names = fs.readdirSync(dir); } catch {}
  return names.some((n) => { try { return fs.readFileSync(path.join(dir, n)).includes(text); } catch { return false; } });
}, 15000, `${text} in Chrome's session files`);
onA('C21 a decline after a half-typed note: bye comes while the old Chrome is alive, and the value is gone', async () => {
  const P = cA();
  await ok(P, ['stop']);
  // the close held 1.5 s after its bye, so what the bye came before can be read
  await ok(P, ['start'], { DEVTEAM_TEST_BROWSER_CLOSE_DELAY_MS: '1500' });
  await ok(P, ['open', `${site.origin}/record`]);
  const q = await askHandover(P);
  const mark = marker('c21');
  const v = await typeNote(P, mark);
  const old = readState(P).chrome_pid;
  assert.ok(alive(old), 'the Chrome to be stopped');
  const a = await owner(P, ['answer', q, '--choice', "Can't right now"]);
  assert.equal(a.status, 0, a.err || a.out);
  await v.waitFor((m) => m.t === 'bye', 15000);
  assert.equal(readState(P).chrome_pid, old, 'state.json has a new Chrome at bye');
  assert.ok(alive(old), 'the old Chrome was already gone at bye');
  v.close();
  const w = await waitJson(P);
  assert.deepEqual([w.qid, w.outcome], [q, 'declined']);
  const s = await ok(P, ['snapshot']);
  assert.match(s.out, BLANK);
  assert.ok(!s.out.includes(mark), 'the half-typed note survived the decline');
  await ok(P, ['screenshot']);
  assert.equal(JSON.parse((await ok(P, ['status', '--json'])).out).url, 'about:blank');
  assert.deepEqual(await tabUrls(P), ['about:blank']);
  entryIs(P, q, 'declined');
  await ok(P, ['stop']); // the close-delay hook ends with this daemon
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

onB('C19 input after the close never reaches the page, on a socket opened during the handover and on one sent held', async () => {
  const P = cB();
  for (const how of ['opened during the handover', 'open before it, sent held']) {
    await ok(P, ['open', `${site.origin}/record`]);
    let q, v;
    if (how.startsWith('opened')) {
      q = await askHandover(P);
      v = await viewSocket(P);
    } else {
      v = await viewSocket(P);
      await v.waitFor((m) => m.t === 'held' && m.qid === null, 5000);
      q = await askHandover(P);
    }
    await v.waitFor((m) => m.t === 'held' && m.qid === q, 5000);
    await typeNote(P, marker('c19'), { v });
    const from = v.msgs.length;
    const a = await owner(P, ['answer', q, '--choice', 'Done']);
    assert.equal(a.status, 0, a.err || a.out);
    const answered = Date.now();
    await v.c.wait((m) => m.t === 'held' && m.qid === null, 5000, from); // the watch still tracks the hold
    await sleep(Math.max(0, 1500 - (Date.now() - answered)));
    assert.equal(v.c.closed, null, `${how}: the socket closed before the late paste`);
    assert.ok(!v.msgs.some((m) => m.t === 'bye'), `${how}: bye before the late paste: no close should have run`);
    const late = `zq-late-${Math.random().toString(36).slice(2, 10)}`;
    v.paste(late);
    await sleep(1500);
    assert.ok(!site.events().some((e) => String(e.value).includes(late)), `${how}: the value typed after the close reached the page`);
    const w = await waitJson(P);
    assert.deepEqual([w.qid, w.outcome], [q, 'done'], how);
    v.close();
  }
  // In the gap: closed, and no close handled yet. (1) a socket opened after the close
  await ok(P, ['open', `${site.origin}/record`]);
  const q1 = await askHandover(P);
  (await typeNote(P, marker('c19-gap'))).close();
  const a1 = await owner(P, ['answer', q1, '--choice', 'Done']);
  assert.equal(a1.status, 0, a1.err || a1.out);
  const late1 = await refusedInGap(P, 'late-gap');
  await sleep(500);
  assert.ok(!landed(late1), 'a socket opened after the close: its input reached the page');
  assert.equal((await waitJson(P)).outcome, 'done');
  // (2) a socket that takes a newer open handover while the older one's close is pending
  await ok(P, ['open', `${site.origin}/record`]);
  const q2 = await askHandover(P);
  (await typeNote(P, marker('c19-gap2'))).close();
  const newer = appendLine(P, handoverLine(P));
  await withdraw(P, q2);
  const late2 = await refusedInGap(P, 'late-gap2');
  await sleep(500);
  assert.ok(!landed(late2), 'a socket on a newer handover, an older close pending: its input reached the page');
  await withdraw(P, newer.id);
  const w2 = await waitJson(P);
  assert.deepEqual([w2.qid, w2.outcome], [newer.id, 'withdrawn']);
  entryIs(P, q2, 'withdrawn');
  entryIs(P, newer.id, 'withdrawn');
  // with no close pending, a new socket's input reaches the page again (R5)
  await ok(P, ['open', `${site.origin}/record`]);
  const after = await nextViewer(P);
  await typeNote(P, marker('c19-after'), { v: after });
  after.close();
});

onB('PC1 while a close is pending no socket is sent a frame, and frames come back once it is handled', async () => {
  const P = cB();
  const allow = { DEVTEAM_TEST_BROWSER_ALLOW: `${site.port},${ticker.address().port}` };
  await ok(P, ['stop']);
  await ok(P, ['start'], allow);
  await ok(P, ['open', `http://127.0.0.1:${ticker.address().port}/`]);
  const q = await askHandover(P);
  const v = await viewSocket(P);
  await until(() => framesIn(v.msgs) >= 3, 15000, 'frames of the repainting page');
  const from = v.msgs.length;
  const a = await owner(P, ['answer', q, '--choice', 'Done']);
  assert.equal(a.status, 0, a.err || a.out);
  await v.c.wait((m) => m.t === 'held' && m.qid === null, 5000, from); // sent the moment the daemon sees the close
  const seen = v.msgs.findIndex((m, i) => i >= from && m.t === 'held' && m.qid === null);
  await sleep(1000);
  assert.equal(v.c.closed, null, 'the socket closed: no close should have run');
  assert.equal(framesIn(v.msgs.slice(seen + 1)), 0, 'frames were sent while the close was pending');
  await refusedInGap(P, 'pc1-gap');
  assert.equal((await waitJson(P)).outcome, 'done');
  v.close();
  // handled: a new viewer gets frames again (R5)
  const again = await nextViewer(P);
  await until(() => framesIn(again.msgs) >= 3, 15000, 'frames after the close was handled');
  again.close();
  await ok(P, ['stop']);
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

onB('T4-1 a defaulted handover the owner answers later closes twice: a second reset and a second entry', async () => {
  const P = cB();
  const l = appendLine(P, handoverLine(P, { default: 'Done', deadline: new Date(Date.now() - 60000).toISOString() }));
  const d = await kit(P, ['answer', l.id, '--defaulted']);
  assert.equal(d.status, 0, d.err || d.out);
  const w1 = await waitJson(P);
  assert.deepEqual([w1.qid, w1.outcome], [l.id, 'declined']);
  assert.equal(entriesFor(P, l.id).length, 1);
  const pid1 = readState(P).chrome_pid;
  // the owner's own answer moves the close time: a close the first entry predates
  const a = await owner(P, ['answer', l.id, '--choice', "Can't right now"]);
  assert.equal(a.status, 0, a.err || a.out);
  const w2 = await waitJson(P);
  assert.deepEqual([w2.qid, w2.outcome], [l.id, 'declined']);
  const es = entriesFor(P, l.id);
  assert.equal(es.length, 2, `the later close was not handled again: ${JSON.stringify(es)}`);
  assert.ok(Date.parse(es[1].at) > Date.parse(es[0].at), JSON.stringify(es));
  assert.notEqual(readState(P).chrome_pid, pid1, 'no second restart');
});

onB('T4-3 a close that fails shuts the daemon down, and the offline status says why', async () => {
  const P = cB();
  await ok(P, ['stop']);
  await ok(P, ['start'], { DEVTEAM_TEST_BROWSER_DELETE_FAILS: '1' });
  await ok(P, ['open', `${site.origin}/record`]);
  const st = readState(P);
  await until(() => fs.existsSync(path.join(P.profile, 'Default', 'Sessions')), 15000, "Chrome's session folder");
  const q = await askHandover(P);
  await withdraw(P, q);
  const s = await browser(P, ['snapshot']);
  assert.notEqual(s.status, 0, `the snapshot was served: ${s.out}`);
  await until(() => !alive(st.daemon_pid), 20000, 'the daemon gone');
  const off = await ok(P, ['status']);
  assert.match(off.out, /^last error: \d{4}-\d\d-\d\dT\S+ browser: couldn't delete \S.* \(EACCES\): Chrome would bring its tabs back$/m, off.out);
  assert.equal(entriesFor(P, q).length, 0, 'a failed close wrote its entry');
  // the next start handles the close, and the old failure is no longer said
  await ok(P, ['start']);
  entryIs(P, q, 'withdrawn');
  await freshViewer(P);
  assert.equal((await waitJson(P)).outcome, 'withdrawn');
  assert.doesNotMatch((await ok(P, ['status'])).out, /last error/);
  await ok(P, ['stop']);
  assert.doesNotMatch((await ok(P, ['status'])).out, /last error/);
});

onB('PC3 a close that never finishes (the daemon killed inside it): no socket is served meanwhile, and the next start ends it', async () => {
  const P = cB();
  await ok(P, ['stop']);
  await ok(P, ['start'], { DEVTEAM_TEST_BROWSER_CLOSE_DELAY_MS: '60000' });
  await ok(P, ['open', `${site.origin}/record`]);
  await sessionHolds(P, '/record');
  const q = await askHandover(P);
  const v = await viewSocket(P);
  await v.waitFor((m) => m.t === 'held' && m.qid === q, 5000);
  await withdraw(P, q);
  const snap = browser(P, ['snapshot']); // its pre-verb read starts the close, held inside it
  await v.waitFor((m) => m.t === 'bye', 15000);
  v.close();
  await refusedInGap(P, 'pc3-inside-the-close');
  await killDaemon(P);
  const r = await snap;
  assert.notEqual(r.status, 0, `the snapshot was served: ${r.out}`);
  assert.equal(entriesFor(P, q).length, 0, 'a close cut short wrote its entry');
  await ok(P, ['start']);
  entryIs(P, q, 'withdrawn');
  await freshViewer(P);
  const w = await waitJson(P);
  assert.deepEqual([w.qid, w.outcome], [q, 'withdrawn']);
  assert.equal(entriesFor(P, q).length, 1, 'the close was handled twice');
  assert.match((await ok(P, ['snapshot'])).out, BLANK);
});

// last on cB: its close line's at doesn't parse, and stays the log's last line
onB('T4-2 problem lines never wedge the browser: a handover gone from the log under wait, a close time that does not parse', async () => {
  const P = cB();
  await ok(P, ['start']);
  // (c) wait's handover gone from the fold while it waits (its live log file moved away): a clear exit 1
  const c = await askHandover(P);
  const dir = path.join(P.run, 'log');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl') && fs.readFileSync(path.join(dir, f), 'utf8').includes(`"id":"${c}"`));
  assert.ok(files.length, `no live log file holds ${c}`);
  const read = path.join(P.home, 'wait-first-read');
  const waiting = browser(P, ['wait'], { DEVTEAM_TEST_BROWSER_WAIT_FIRST_READ: read });
  await until(() => fs.existsSync(read), 60000, "wait's first read of the log");
  for (const f of files) fs.renameSync(path.join(dir, f), path.join(P.home, f));
  let w;
  try { w = await waiting; } finally { for (const f of files) fs.renameSync(path.join(P.home, f), path.join(dir, f)); }
  assert.equal(w.status, 1, w.out);
  assert.match(w.err, new RegExp(`browser wait: ${c} is no longer in the log as a handover of this browser; nothing to wait for`), w.err);
  await withdraw(P, c);
  assert.match((await ok(P, ['snapshot'])).out, BLANK);
  entryIs(P, c, 'withdrawn');
  // (a) a close time that doesn't parse: read as closed now, handled once
  const a = appendLine(P, handoverLine(P));
  appendLine(P, { type: 'question', op: 'set', id: a.id, status: 'withdrawn', reason: 'a close time that does not parse', at: 'not a time' });
  assert.match((await ok(P, ['snapshot'])).out, BLANK);
  entryIs(P, a.id, 'withdrawn');
  await ok(P, ['snapshot']);
  assert.equal(entriesFor(P, a.id).length, 1, 'handled again by the same daemon');
  // a new daemon still starts and serves, and finds that close handled by its entry: once overall
  await ok(P, ['stop']);
  await ok(P, ['start']);
  assert.match((await ok(P, ['snapshot'])).out, BLANK);
  assert.equal(entriesFor(P, a.id).length, 1, 'a new daemon handled the close with no time again');
});

// --- cC: DEVTEAM_TEST_BROWSER_IDLE_MS=1500
let CC;
const cC = () => (CC ??= project('cC', { DEVTEAM_TEST_BROWSER_IDLE_MS: '1500' }));

onC('C24 the idle timer never stops the browser while held, and stops it after the close', async () => {
  const P = cC();
  // the handover is in the log before the daemon starts, so no idle gap comes before the hold
  const l = appendLine(P, handoverLine(P));
  await ok(P, ['start']);
  const st = readState(P);
  await sleep(4000);
  assert.ok(alive(st.daemon_pid), 'the daemon stopped for idleness while held');
  assert.ok(alive(readState(P)?.chrome_pid ?? st.chrome_pid), 'Chrome stopped while held');
  await withdraw(P, l.id);
  // "after the close": the daemon's close, which ends with its ledger entry and arms the timer again
  await until(() => entriesFor(P, l.id).length, 20000, 'the close handled');
  await until(() => !alive(st.daemon_pid), 4000, 'the daemon stopped for idleness after the close');
  await until(() => !profilePids(P).length, 5000, 'Chrome gone with the daemon');
});

onC('T6-3 the idle timer never stops the daemon with a close unhandled', async () => {
  const P = cC();
  // the watch queues nothing, so the close stays unhandled for two idle periods
  const l = appendLine(P, handoverLine(P));
  await ok(P, ['start'], { DEVTEAM_TEST_BROWSER_WATCH_HANDLE: '0' });
  const st = readState(P);
  await withdraw(P, l.id);
  await sleep(3500);
  assert.ok(alive(st.daemon_pid), 'the daemon stopped for idleness with a close unhandled');
  assert.equal(entriesFor(P, l.id).length, 0, 'the close was handled early');
  assert.deepEqual((await waitJson(P)).outcome, 'withdrawn');
  assert.equal(readState(P).daemon_pid, st.daemon_pid, 'wait had to start a new daemon');
  entryIs(P, l.id, 'withdrawn');
  await until(() => !alive(st.daemon_pid), 4000, 'the daemon stopped for idleness once the close was handled');
});

onC('RF2 Sign out of everything during a handover, then its close: the forget runs first, and the ledger records the close', async () => {
  const P = cC();
  await ok(P, ['start'], { DEVTEAM_TEST_BROWSER_IDLE_MS: '120000', DEVTEAM_TEST_BROWSER_FORGET_DELAY_MS: '4000' });
  const q = await askHandover(P);
  const pid0 = readState(P).chrome_pid;
  const mark = path.join(P.profile, 'zq-before-the-forget');
  fs.writeFileSync(mark, 'x');
  const v = await viewSocket(P);
  await v.waitFor((m) => m.t === 'held' && m.qid === q, 5000);
  v.send({ t: 'forget' });
  // the forget is running once the view refuses a new socket (503) while it restarts
  await until(async () => { try { (await viewSocket(P)).close(); return false; } catch (e) { return /503/.test(e.message); } }, 3000, 'the forget under way');
  await withdraw(P, q);
  assert.equal(readState(P).chrome_pid, pid0, 'the withdraw should land inside the forget');
  await v.waitFor((m) => m.t === 'bye', 30000);
  const pid1 = readState(P).chrome_pid;
  assert.notEqual(pid1, pid0, "the close began before the forget's restart ended");
  assert.ok(!fs.existsSync(mark), "the close began before the forget's wipe");
  v.close();
  const w = await waitJson(P);
  assert.deepEqual([w.qid, w.outcome], [q, 'withdrawn']);
  entryIs(P, q, 'withdrawn');
  assert.equal(entriesFor(P, q).length, 1);
  assert.notEqual(readState(P).chrome_pid, pid1, 'the close restarted Chrome after the forget');
  assert.match((await ok(P, ['snapshot'])).out, BLANK);
  await ok(P, ['stop']);
});

test('the close on cA, cB, cC and cD, four chains at once (C17: every ledger validates after each check)', { skip, timeout: 280000, concurrency: 4 }, async (t) => {
  const chain = (P, checks) => t.test(`on ${P().name}`, { concurrency: 1 }, async (c) => {
    for (const [name, fn] of checks) await c.test(name, { timeout: 120000 }, async () => { await fn(); ledgerValid(P()); });
    await c.test('C17 resets.json validates against shapes.resets, mode 0600', () => {
      assert.ok(fs.existsSync(P().ledger), 'no resets.json after the closes');
      ledgerValid(P());
    });
  });
  await Promise.all([chain(cA, cAChecks), chain(cB, cBChecks), chain(cC, cCChecks), chain(cD, cDChecks)]);
});
