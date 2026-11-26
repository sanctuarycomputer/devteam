// The browser handover's close (kit-67): what happens once the owner hands the browser back, and the
// repeated-site warning. Each check is the spec's
// (docs/devteam/project/tickets/kit-67-browser-handover/spec.md, home), named by its id. Every check
// needs Chrome and skips without canDrive; the mustRun guard fails the file instead on CI's Node 22+.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
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
// a chain: cA's (C23, C15, C20, W1, C21, RF3, KD2, KD5, KD3, KD4, KD9, KD10, KD11), cB's (C18, C19, PC1, PC4, PC5, RF4, T4-1, T4-3, KD6, PC3, T4-2),
// cC's (C24, T6-3, RF2, RL0, RL1, RL2, KD8, KD8b, RL3) and cD's (C12, C13, C14, KD1, KD7, C16, PC6). onA, onB, onC and onD add a check.
const cAChecks = [], cBChecks = [], cCChecks = [], cDChecks = [];
const onA = (name, fn) => cAChecks.push([name, fn]);
const onB = (name, fn) => cBChecks.push([name, fn]);
const onC = (name, fn) => cCChecks.push([name, fn]);
const onD = (name, fn) => cDChecks.push([name, fn]);
if (mustRun && !canDrive) test('Chrome is needed on CI\'s Node 22+', () => assert.fail('Chrome is needed on CI\'s Node 22+: this file must run there, not skip'));

// C23's own sites: hosts no other check hands over, so only C23's handovers name them. S2 carries
// the 8-day case and the near miss, S3 the 6-day, second-handover and after-forget cases: the live
// handover of the 8-day case names S2, so it is never an earlier handover of S3's cases.
let S2, S3, ticker, tickerGo = false, tickerLanded = 0;
before(async () => {
  S2 = await startSites();
  S3 = await startSites();
  // a page that repaints all the time, so the screencast has frames to send whenever it is allowed to
  // and that moves itself to /landed once the test says so (tickerGo)
  const tick = 'let i = 0; setInterval(() => { document.getElementById("n").textContent = ++i; document.body.style.background = i % 2 ? "#fff" : "#eee"; }, 40);';
  const hop = 'setInterval(async () => { try { if ((await (await fetch("/go", { cache: "no-store" })).text()) === "1") location.href = "/landed"; } catch {} }, 100);';
  ticker = http.createServer((req, res) => {
    if (req.url === '/go') { res.writeHead(200, { 'content-type': 'text/plain', 'cache-control': 'no-store' }); return res.end(tickerGo ? '1' : '0'); }
    if (req.url === '/landed') tickerLanded++;
    res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
    res.end(`<!doctype html><title>ticker</title><p id="n">0</p><script>${tick}${req.url === '/landed' ? '' : hop}</script>`);
  });
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
// v: the owner's view socket, still open. The close's steps are timed from the answer too, each as a
// 50 ms poll (running from before the answer command) first saw it, so a miss names its slow step: the view's bye (the daemon took the close,
// after its 500 ms watch), the old Chrome's exit (Browser.close until it is gone; the session files
// are deleted only after), and the first clean scan (the process wait and the delete).
async function closeAndScan(P, q, close, label, v, before) {
  await codeOnDisk(P, site.code);
  const oldPid = readState(P)?.chrome_pid;
  assert.ok(Number.isInteger(oldPid) && alive(oldPid), `${label}: a live Chrome before the answer (state.json's chrome_pid ${oldPid})`);
  const loop = scanLoop(P, [site.password, site.code]);
  let w, answerAt, clean, byeAt = null, goneAt = null;
  const mark = () => {
    const now = Date.now();
    if (byeAt === null && v.msgs.some((m) => m.t === 'bye')) byeAt = now;
    if (goneAt === null && !alive(oldPid)) goneAt = now;
  };
  if (before) { try { await before(oldPid); } catch (e) { await loop.stop(); throw e; } } // kit-877: KD1 freezes Chrome's helpers here, with the scan running (stopped if that throws)
  const tick = setInterval(mark, 50); // from before the answer command, so a bye or exit during it is seen
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
  } finally { mark(); clearInterval(tick); await loop.stop(); }
  const ms = clean - answerAt;
  let load = '?';
  try { load = fs.readFileSync('/proc/loadavg', 'utf8').split(' ').slice(0, 3).join(' '); } catch {}
  const took = loop.scans.map((s) => s.ms);
  const first = loop.scans.find((s) => s.at === clean);
  const since = (t) => (t === null ? 'not seen' : `${t - answerAt} ms`);
  const steps = `from the answer: the view's bye ${since(byeAt)} (the daemon took the close), the old Chrome (pid ${oldPid}) gone ${since(goneAt)} (Browser.close until its exit), the first clean scan ${ms} ms (the process wait and the delete)`;
  console.log(`# kit-67 ${label}: answer to first clean scan ${ms} ms (by its end ${clean + first.ms - answerAt} ms; ${loop.scans.length} scans, each ${Math.min(...took)}-${Math.max(...took)} ms; load ${load}); ${steps}`);
  const late = loop.scans.filter((s) => s.found.length && (s.at >= answerAt + 2000 || s.at >= clean));
  assert.deepEqual(late.map((s) => ({ after: s.at - answerAt, found: s.found })), [], `${label}: a secret on disk 2 s after the answer, or after a clean scan; ${steps}; load ${load}`);
  return { w, ms };
}
// kit-877: a Chrome too slow to close itself, made so on purpose. freezeHelpers SIGSTOPs every process
// of Chrome's group (pgid chromePid) but Chrome itself and its network service (which answers the
// cookie read), and returns their pids; thaw SIGKILLs those still alive and still in that group (a pid
// that left it, or was reused, is left alone). Each check that freezes thaws in a finally and then
// waits for every frozen pid to be gone, so no stopped process is left on the machine.
const pgOf = (pid) => { try { const st = fs.readFileSync(`/proc/${pid}/stat`, 'utf8'); return Number(st.slice(st.lastIndexOf(')') + 2).split(' ')[2]); } catch { return null; } };
const cmdOf = (pid) => { try { return fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8'); } catch { return ''; } };
function freezeHelpers(chromePid) {
  assert.ok(Number.isInteger(chromePid) && alive(chromePid), `a live Chrome to freeze the helpers of (${chromePid})`);
  const pids = fs.readdirSync('/proc').filter((d) => /^\d+$/.test(d)).map(Number).filter((p) => p !== chromePid && pgOf(p) === chromePid && !cmdOf(p).includes('NetworkService'));
  assert.ok(pids.length, "Chrome's helpers to freeze");
  for (const p of pids) { try { process.kill(p, 'SIGSTOP'); } catch {} }
  return pids;
}
const thaw = (pids, group) => { for (const p of pids) if (alive(p) && pgOf(p) === group) { try { process.kill(p, 'SIGKILL'); } catch {} } };
const thawed = (pids, label) => until(() => pids.every((p) => !alive(p)), 5000, `${label}: every frozen helper gone`);
// kit-877: the typed text on disk, then the daemon killed -9 (its Chrome left to the reaper, with its
// helpers frozen first when freeze), and nothing else run: a scan clean within 8 s of the kill, and
// none found after. Then the close is handled as any killed daemon's: a withdraw and the next start.
// The login is on a site of its own (kdSite, allowed by this start only): cD's C12 and C13 count every
// sign-in POST the shared site sees as a replay, and the chains run at once.
let kdSite;
before(async () => { kdSite = await startSites(); });
after(async () => { await kdSite?.close(); });
async function killedMidHandover(P, label, freeze) {
  const S = kdSite;
  await ok(P, ['stop']);
  await ok(P, ['start'], { DEVTEAM_TEST_BROWSER_ALLOW: `${site.port},${S2.port},${S3.port},${S.port}` });
  await ok(P, ['open', `${S.origin}/login`]);
  const q = await askHandover(P);
  const v = await ownerLogIn(P, { S, to: `${S.origin}/account` });
  v.close();
  await codeOnDisk(P, S.code);
  const group = readState(P).chrome_pid;
  let frozen = [];
  const loop = scanLoop(P, [S.password, S.code]);
  let killedAt;
  try {
    if (freeze) frozen = freezeHelpers(group);
    await killDaemon(P);
    killedAt = Date.now();
    await until(() => loop.firstCleanAfter(killedAt) !== null, 8000, `${label}: a clean scan after the kill`);
    await sleep(2000);
  } finally { await loop.stop(); thaw(frozen, group); }
  await thawed(frozen, label);
  const clean = loop.firstCleanAfter(killedAt);
  console.log(`# kit-877 ${label}: kill to first clean scan ${clean - killedAt} ms`);
  assert.deepEqual(loop.scans.filter((x) => x.at >= clean && x.found.length).map((x) => ({ after: x.at - killedAt, found: x.found })), [], `${label}: a secret back on disk after a clean scan`);
  await withdraw(P, q);
  await ok(P, ['start']);
  entryIs(P, q, 'withdrawn');
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
  const { w } = await closeAndScan(P, q, async () => { const a = await owner(P, ['answer', q, '--choice', 'Done']); assert.equal(a.status, 0, a.err || a.out); }, 'C12', v);
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
  }, 'C13', v);
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
    const { w } = await closeAndScan(P, q, close(q), label, v);
    v.close();
    assert.deepEqual([w.qid, w.outcome, w.reopened], [q, outcome, undefined], label);
    assert.deepEqual(await tabUrls(P), ['about:blank'], label);
    entryIs(P, q, outcome);
    await ok(P, ['open', `${site.origin}/account`]);
    const s = await ok(P, ['snapshot']);
    assert.ok(s.out.includes(SIGNED), `${label}: the session was lost: ${s.out.slice(0, 300)}`);
  }
});

onD('KD1 a close with Chrome\'s helpers frozen (too slow to close itself): the password and code leave the disk within 2 s of Done, and the page reopens signed in', async () => {
  const P = cD();
  await ok(P, ['open', `${site.origin}/login`]);
  const q = await askHandover(P);
  const v = await ownerLogIn(P, { to: `${site.origin}/account` });
  let frozen = [], group = null;
  try {
    const { w } = await closeAndScan(P, q, async () => { const a = await owner(P, ['answer', q, '--choice', 'Done']); assert.equal(a.status, 0, a.err || a.out); }, 'KD1', v, (oldPid) => { group = oldPid; frozen = freezeHelpers(oldPid); });
    assert.deepEqual([w.qid, w.outcome, w.reopened], [q, 'done', [`${site.origin}/account`]]);
    const s = await ok(P, ['snapshot']);
    assert.ok(s.out.includes(SIGNED), `KD1: the page reopened isn't signed in: ${s.out.slice(0, 300)}`);
  } finally { v.close(); thaw(frozen, group); }
  await thawed(frozen, 'KD1');
});

onD('KD7 a late close (held past its deadline) with Chrome\'s helpers frozen: the cookies are still read first, and the page reopens signed in', async () => {
  const P = cD();
  await ok(P, ['stop']);
  await ok(P, ['start'], { DEVTEAM_TEST_BROWSER_CLOSE_DELAY_MS: '1500' });
  await ok(P, ['open', `${site.origin}/login`]);
  const q = await askHandover(P);
  const v = await ownerLogIn(P, { to: `${site.origin}/account` });
  const group = readState(P).chrome_pid;
  let frozen = [];
  try {
    frozen = freezeHelpers(group);
    const a = await owner(P, ['answer', q, '--choice', 'Done']);
    assert.equal(a.status, 0, a.err || a.out);
    const w = await waitJson(P);
    assert.deepEqual([w.qid, w.outcome], [q, 'done']);
    const s = await ok(P, ['snapshot']);
    assert.ok(s.out.includes(SIGNED), `KD7: the page reopened isn't signed in: ${s.out.slice(0, 300)}`);
  } finally { v.close(); thaw(frozen, group); }
  await thawed(frozen, 'KD7');
  await ok(P, ['stop']);
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

onA('KD2 a daemon killed mid-handover: what was typed leaves the disk within 8 s of the kill, with nothing else run', () => killedMidHandover(cA(), 'KD2', false));

onA('KD5 a daemon killed mid-handover with its Chrome\'s helpers frozen (its own shutdown stalls): what was typed leaves the disk within 8 s of the kill', () => killedMidHandover(cA(), 'KD5', true));

// kit-877: a failed delete is said, never swallowed. Every delete fails (the hook); Chrome has written
// its session files first.
const DELETE_FAILS = { DEVTEAM_TEST_BROWSER_DELETE_FAILS: '1' };
const LAST_DELETE = /^last error: \d{4}-\d\d-\d\dT\S+ browser: couldn't delete \S.* \(EACCES\): Chrome would bring its tabs back$/m;
onA('KD3 a failed delete as the daemon shuts down (its Chrome killed -9; the reaper off) is said by the offline status', async () => {
  const P = cA();
  await ok(P, ['stop']);
  await ok(P, ['start'], { ...DELETE_FAILS, DEVTEAM_TEST_BROWSER_REAP: '0' });
  await ok(P, ['open', `${site.origin}/record`]);
  const st = readState(P);
  await until(() => fs.existsSync(path.join(P.profile, 'Default', 'Sessions')), 15000, "Chrome's session folder");
  process.kill(-st.chrome_pid, 'SIGKILL');
  await until(() => !alive(st.daemon_pid), 20000, 'the daemon gone');
  const off = await ok(P, ['status']);
  assert.match(off.out, LAST_DELETE, off.out);
  await ok(P, ['start']);
  await ok(P, ['stop']);
});

onA('KD4 a failed delete after the daemon is killed -9 is said by the offline status (the reaper)', async () => {
  const P = cA();
  await ok(P, ['stop']);
  await ok(P, ['start'], DELETE_FAILS);
  await ok(P, ['open', `${site.origin}/record`]);
  await until(() => fs.existsSync(path.join(P.profile, 'Default', 'Sessions')), 15000, "Chrome's session folder");
  await killDaemon(P);
  const off = await until(async () => { const r = await ok(P, ['status']); return /last error/.test(r.out) ? r : null; }, 10000, 'KD4: the offline status says the failed delete');
  assert.match(off.out, LAST_DELETE, off.out);
  await ok(P, ['start']);
  await ok(P, ['stop']);
});

// kit-877 (ruling m-20261125-103500671): a clean stop deleted the session files itself and told its
// reaper so; nothing of the old daemon's touches what comes after it. A file in Default/Sessions
// planted right after the stop (as a start's Chrome would write one) is still there 3 s later.
onA('KD9 a clean stop: its reaper stands down, so a file written on the profile right after the stop is kept', async () => {
  const P = cA();
  await ok(P, ['start']);
  await ok(P, ['open', `${site.origin}/record`]);
  await until(() => fs.existsSync(path.join(P.profile, 'Default', 'Sessions')), 15000, "Chrome's session folder");
  await ok(P, ['stop']);
  const f = path.join(P.profile, 'Default', 'Sessions', 'kd9-kept');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, 'x');
  try {
    await sleep(3000); // a reaper that ran would have deleted it within about 1 s (a node start)
    assert.ok(fs.existsSync(f), "KD9: the old daemon's reaper deleted a file written after a clean stop");
  } finally { fs.rmSync(f, { force: true }); }
});

// kit-877 (m-20261125-140559755): the four chains, like two projects on one box, pick view ports blind
// to each other; a start whose bind is taken retries on a random free port, up to four tries in all.
// The hook fails the first three binds and lists their ports; the start comes up on the fourth. kit-923:
// each try is a port of the view range that no earlier try lost (a lowest-free retry tries a lost one again).
const lostPorts = (marker) => fs.readFileSync(marker, 'utf8').split('\n').filter(Boolean).map(Number);
onA('KD10 a start whose first three binds are taken still comes up, each try on a port no earlier try lost', async () => {
  const P = cA();
  const marker = path.join(P.home, 'kd10-bind-fails');
  fs.rmSync(marker, { force: true });
  await ok(P, ['stop']);
  try {
    await ok(P, ['start'], { DEVTEAM_TEST_BROWSER_BIND_FAIL: marker, DEVTEAM_TEST_BROWSER_BIND_FAIL_N: '3' });
    const tried = [...lostPorts(marker), readState(P).view_port];
    assert.equal(tried.length, 4, `KD10: three binds failed first, then one came up: ${tried.join(', ')}`);
    for (const p of tried) assert.ok(p >= 4400 && p <= 4499, `KD10: port ${p} is outside the view range 4400-4499: ${tried.join(', ')}`);
    assert.equal(new Set(tried).size, 4, `KD10: a retry tried a port this start had lost: ${tried.join(', ')}`);
    assert.ok(alive(readState(P).daemon_pid), 'KD10: the daemon is up');
  } finally { fs.rmSync(marker, { force: true }); }
  await ok(P, ['stop']);
});

// kit-923: with no port left to retry on but those this start lost, the start fails in words and never
// tries a lost one again. The pool hook narrows the retries to 4498 and 4499; the first try and both of
// theirs fail, so none is left.
onA('KD11 a start that has lost every port it could retry on fails in words, never on a lost port again', async () => {
  const P = cA();
  const marker = path.join(P.home, 'kd11-bind-fails');
  fs.rmSync(marker, { force: true });
  await ok(P, ['stop']);
  try {
    const r = await browser(P, ['start'], { DEVTEAM_TEST_BROWSER_BIND_FAIL: marker, DEVTEAM_TEST_BROWSER_BIND_FAIL_N: '3', DEVTEAM_TEST_BROWSER_RETRY_POOL: '4498,4499' });
    const lost = lostPorts(marker);
    assert.notEqual(r.status, 0, `KD11: the start came up after losing ${lost.join(', ')}: ${r.out}`);
    assert.match(r.err, /devteam: browser: no free view port left in 4400-4499 to retry on: this start lost \d+, 449[89], 449[89]\b/, r.err);
    assert.deepEqual([...lost.slice(1)].sort(), [4498, 4499], `KD11: the retries were not the pool's two ports: ${lost.join(', ')}`);
  } finally { fs.rmSync(marker, { force: true }); }
  await ok(P, ['start']);
  await ok(P, ['stop']);
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
  tickerGo = false;
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
  const landedBefore = tickerLanded;
  tickerGo = true; // the page moves itself, with the close pending
  await until(() => tickerLanded > landedBefore, 10000, 'the page moved itself');
  await sleep(1000);
  assert.equal(v.c.closed, null, 'the socket closed: no close should have run');
  assert.equal(framesIn(v.msgs.slice(seen + 1)), 0, 'frames were sent while the close was pending');
  assert.deepEqual(v.msgs.slice(seen + 1).filter((m) => m.t === 'url').map((m) => m.url), [], 'a url was sent while the close was pending');
  await refusedInGap(P, 'pc1-gap');
  assert.equal((await waitJson(P)).outcome, 'done');
  v.close();
  // handled: a new viewer gets frames again (R5)
  const again = await nextViewer(P);
  await until(() => framesIn(again.msgs) >= 3, 15000, 'frames after the close was handled');
  again.close();
  await ok(P, ['stop']);
});

onB('PC4 each input during a handover reads the log first: a close line just written, or a failed read, stops it', async () => {
  const P = cB();
  const fails = path.join(P.home, 'view-read-fails');
  await ok(P, ['stop']);
  // the watch slowed so far that only the input's own read can see the close
  await ok(P, ['start'], { DEVTEAM_TEST_BROWSER_WATCH_MS: '600000', DEVTEAM_TEST_BROWSER_VIEW_READ_FAILS: fails });
  // outside a handover no read is made (R5): a read that would fail doesn't stop the input
  await ok(P, ['open', `${site.origin}/record`]);
  const out = await nextViewer(P);
  fs.writeFileSync(fails, '');
  await typeNote(P, marker('pc4-outside'), { v: out });
  out.close();
  fs.rmSync(fails, { force: true });
  await ok(P, ['open', `${site.origin}/record`]);
  const q = await askHandover(P);
  const v = await nextViewer(P);
  await v.waitFor((m) => m.t === 'held' && m.qid === q, 5000);
  await typeNote(P, marker('pc4-note'), { v });
  // the read fails: dropped; it reads again: forwarded
  fs.writeFileSync(fails, '');
  const dropped = marker('pc4-failed-read');
  v.paste(dropped);
  await sleep(600);
  assert.ok(!landed(dropped), 'an input whose read failed reached the page');
  fs.rmSync(fails, { force: true });
  const back = marker('pc4-read-again');
  v.paste(back);
  await until(() => landed(back), 5000, 'the input once the read works');
  // a close line written right after an input's read, and the next input at once
  v.send({ t: 'mouse', type: 'move', x: 10, y: 10 });
  await sleep(100);
  appendLine(P, { type: 'question', op: 'set', id: q, status: 'withdrawn', reason: 'a close the daemon has not read' });
  const late = marker('pc4-late');
  v.paste(late);
  await sleep(800);
  assert.ok(!landed(late), 'an input sent after the close line, before any other read, reached the page');
  assert.equal(v.c.closed, null, 'the socket closed: nothing should have handled the close yet');
  const w = await waitJson(P);
  assert.deepEqual([w.qid, w.outcome], [q, 'withdrawn']);
  v.close();
  await ok(P, ['stop']);
});

// A close that reaches this checkout only through main: the log file with its close line committed from
// another worktree, pushed, and fetched here. No file in this checkout changes.
const gitIn = (P, dir, args) => new Promise((resolve, reject) => execFile('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...args], { env: { ...P.env, HOME: P.home } }, (e, out) => (e ? reject(e) : resolve(out))));
async function closeThroughMain(P, q) {
  const live = path.join(P.run, 'log');
  const file = fs.readdirSync(live).find((n) => n.endsWith('.jsonl') && fs.readFileSync(path.join(live, n), 'utf8').includes(`"id":"${q}"`));
  assert.ok(file, `no live log file holds ${q}`);
  const dir = path.join(P.home, `main-${q}`);
  await gitIn(P, P.old, ['fetch', '-q', 'origin']);
  await gitIn(P, P.old, ['worktree', 'add', '-q', '--detach', dir, 'origin/main']);
  const at = new Date().toISOString();
  const target = path.join(dir, 'docs', 'devteam', 'project', 'log', file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  // main's copy keeps the closes already on it; the live lines it lacks are added
  const had = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
  const known = new Set(had.split('\n'));
  const added = fs.readFileSync(path.join(live, file), 'utf8').split('\n').filter((l) => l && !known.has(l));
  fs.writeFileSync(target, `${had}${added.length ? `${added.join('\n')}\n` : ''}${JSON.stringify({ v: 1, id: q, type: 'question', op: 'set', at, by: 'supervisor', status: 'withdrawn', reason: 'closed on main' })}\n`);
  await gitIn(P, dir, ['add', '-f', '--', target]);
  await gitIn(P, dir, ['commit', '-q', '--no-verify', '-m', 'the close, on main']);
  await gitIn(P, dir, ['push', '-q', '--no-verify', 'origin', 'HEAD:main']);
  await gitIn(P, P.old, ['fetch', '-q', 'origin']);
  await gitIn(P, P.old, ['worktree', 'remove', '--force', dir]);
}

onB('PC5 a close that arrives only through main: a socket opened then is refused', async () => {
  const P = cB();
  await ok(P, ['start']);
  await ok(P, ['open', `${site.origin}/record`]);
  const q = await askHandover(P);
  await closeThroughMain(P, q);
  const x = await viewSocket(P);
  const m = await x.waitFor((o) => o.t === 'held' || o.t === 'bye', 10000);
  assert.equal(m.t, 'bye', `a socket opened after a close on main became the viewer: ${JSON.stringify(m)}`);
  assert.equal(framesIn(x.msgs), 0, 'it was sent a frame');
  x.close();
  const w = await waitJson(P);
  assert.deepEqual([w.qid, w.outcome], [q, 'withdrawn']);
  entryIs(P, q, 'withdrawn');
});

// Main's own refresh and the watch are both slowed out of reach: only the input's own check can see main
// move. Every case is collected, so one failing doesn't hide the others.
onD('PC6 an input on an open socket checks main first: loose, packed, a same-size rewrite, and a failed check', async () => {
  const P = cD();
  const fails = path.join(P.home, 'main-check-fails');
  await ok(P, ['stop']);
  await ok(P, ['start'], { DEVTEAM_TEST_BROWSER_WATCH_MS: '600000', DEVTEAM_TEST_BROWSER_MAIN_MS: '600000', DEVTEAM_TEST_BROWSER_MAIN_CHECK_FAILS: fails });
  const common = (await gitIn(P, P.old, ['rev-parse', '--path-format=absolute', '--git-common-dir'])).trim();
  const loose = path.join(common, 'refs', 'remotes', 'origin', 'main');
  const pack = () => gitIn(P, P.old, ['pack-refs', '--all']);
  const touchRef = (from, to) => new Promise((resolve, reject) => execFile('touch', ['-r', from, to], (e) => (e ? reject(e) : resolve())));
  const bad = [];
  const dropped = async (v, what) => { const t = marker(`pc6-${what}`); v.paste(t); await sleep(400); if (landed(t)) bad.push(`${what}: the input reached the page`); };
  const lands = async (v, what) => { const t = marker(`pc6-${what}`); v.paste(t); await until(() => landed(t), 5000, what).catch(() => bad.push(`${what}: the input never landed`)); };
  const viewer = async () => {
    await ok(P, ['open', `${site.origin}/record`]);
    const q = await askHandover(P);
    const v = await nextViewer(P);
    await v.waitFor((m) => m.t === 'held' && m.qid === q, 5000);
    await typeNote(P, marker('pc6-note'), { v }); // this input's check has seen main as it is now
    return { q, v };
  };
  const round = async (what, { before, close }) => {
    if (before) await before();
    const { q, v } = await viewer();
    await close(q);
    await dropped(v, what);
    const y = await viewSocket(P); // a connect's read: the daemon sees the close even where the input's check didn't
    await y.waitFor((o) => o.t === 'bye' || o.t === 'held', 10000);
    y.close();
    const w = await waitJson(P);
    if (w.qid !== q || w.outcome !== 'withdrawn') bad.push(`${what}: wait said ${JSON.stringify(w)}`);
    v.close();
  };
  // no handover known: no stat is made (R5), so a stat that would fail stops nothing
  await ok(P, ['open', `${site.origin}/record`]);
  const out = await nextViewer(P);
  fs.writeFileSync(fails, 'stat');
  await typeNote(P, marker('pc6-outside'), { v: out }).catch(() => bad.push('no handover: a failing stat stopped the input'));
  fs.rmSync(fails, { force: true });
  out.close();
  await round('loose', { close: async (q) => { await closeThroughMain(P, q); assert.ok(fs.existsSync(loose), 'the ref is loose'); } });
  await round('packed', { before: pack, close: async (q) => { await closeThroughMain(P, q); await pack(); assert.ok(!fs.existsSync(loose), 'the ref is packed'); } });
  const stamp = path.join(P.home, 'pc6-stamp');
  await round('same-size', {
    before: async () => { fs.mkdirSync(path.dirname(loose), { recursive: true }); fs.writeFileSync(loose, `${(await gitIn(P, P.old, ['rev-parse', 'refs/remotes/origin/main'])).trim()}\n`); fs.writeFileSync(stamp, ''); await touchRef(loose, stamp); await touchRef(stamp, loose); },
    close: async (q) => {
      const was = fs.statSync(loose, { bigint: true });
      await closeThroughMain(P, q);
      await touchRef(stamp, loose);
      const now = fs.statSync(loose, { bigint: true });
      assert.deepEqual([now.size, now.mtimeNs], [was.size, was.mtimeNs], 'the rewrite keeps the size and the mtime');
      assert.notEqual(now.ino, was.ino, 'the rewrite is a new file');
    },
  });
  // a failed stat, then a failed re-read: dropped, and the input works again after each
  const { q, v } = await viewer();
  fs.writeFileSync(fails, 'stat');
  await dropped(v, 'failed-stat');
  fs.rmSync(fails, { force: true });
  await lands(v, 'after-stat');
  fs.writeFileSync(fails, 'read');
  const later = new Date(Date.now() + 2000);
  fs.utimesSync(path.join(common, 'packed-refs'), later, later);
  await dropped(v, 'failed-re-read');
  fs.rmSync(fails, { force: true });
  await lands(v, 'after-re-read');
  await withdraw(P, q);
  assert.equal((await waitJson(P)).outcome, 'withdrawn');
  v.close();
  await ok(P, ['stop']);
  assert.deepEqual(bad, []);
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
  assert.equal(off.out.split("couldn't delete").length - 1, 1, `kit-877: the shutdown added to a reason that already said the delete failed: ${off.out}`);
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

// kit-877 KD6's site: /set writes a sign-in token to localStorage; any other path only reads it and says
// whether it is there.
let lsSite;
before(async () => {
  lsSite = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
    if (req.url === '/set') return res.end('<!doctype html><title>set</title><script>localStorage.setItem("signin", "tok-kd6")</script><h1>token written</h1>');
    res.end('<!doctype html><title>check</title><h1 id="h">?</h1><script>document.getElementById("h").textContent = localStorage.getItem("signin") === "tok-kd6" ? "token present" : "no token"</script>');
  });
  await new Promise((r) => lsSite.listen(0, '127.0.0.1', r));
});
after(async () => { lsSite?.closeAllConnections?.(); await new Promise((r) => (lsSite ? lsSite.close(r) : r())); });

onB('KD6 a sign-in kept in localStorage, written 2 s before Done, is still there after the close', async () => {
  const P = cB();
  const ls = `http://127.0.0.1:${lsSite.address().port}`;
  await ok(P, ['stop']);
  await ok(P, ['start'], { DEVTEAM_TEST_BROWSER_ALLOW: `${site.port},${lsSite.address().port}` });
  await ok(P, ['open', `${ls}/set`]);
  const wrote = Date.now();
  assert.ok((await ok(P, ['snapshot'])).out.includes('token written'));
  await ok(P, ['open', `${ls}/home`]); // the reopen after Done must not write the token again
  const q = await askHandover(P);
  await sleep(Math.max(0, wrote + 2000 - Date.now()));
  const a = await owner(P, ['answer', q, '--choice', 'Done']);
  assert.equal(a.status, 0, a.err || a.out);
  assert.equal((await waitJson(P)).outcome, 'done');
  await ok(P, ['open', `${ls}/check`]);
  const c = await ok(P, ['snapshot']);
  assert.ok(c.out.includes('token present'), `KD6: the localStorage sign-in was lost: ${c.out.slice(0, 300)}`);
  await ok(P, ['stop']);
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
  // a verb that times out on the close says it may still be finishing, never how it ended
  // wait (its settle call) too, its own bound short so a swallowed timeout ends it with other words (R3-2)
  for (const args of [['tabs'], ['status'], ['stop'], ['wait']]) {
    const t = await browser(P, args, { DEVTEAM_TEST_BROWSER_CALL_MS: '800', DEVTEAM_TEST_BROWSER_WAIT_MS: '2000' });
    assert.equal(t.status, 1, `${args[0]}: ${t.out} ${t.err}`);
    assert.match(t.err, /the daemon didn't answer in 1 s; a close may still be finishing/, `${args[0]}: ${t.err}`);
    assert.doesNotMatch(`${t.out} ${t.err}`, /stopped|failed|succeeded|not running/, `${args[0]} said how it ended`);
  }
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
// Why a close went unhandled, for a wait that has already failed: the old Chrome still ending, or gone
// and the fresh one not up yet (slow), or the daemon gone with its reason (failed). Then up to 30 s more
// (a relaunch's own launch limit), only to say which of the two it came to.
async function closeState(P, st, qid) {
  const read = (f) => { try { return fs.readFileSync(f, 'utf8').trim(); } catch { return 'none'; } };
  const now = () => `old Chrome ${alive(st.chrome_pid) ? 'alive' : 'gone'}, daemon ${alive(st.daemon_pid) ? 'alive' : 'gone'}, load ${read('/proc/loadavg')}`;
  const first = now(), t0 = Date.now();
  while (Date.now() - t0 < 30000 && alive(st.daemon_pid) && !entriesFor(P, qid).length) await sleep(100);
  const ms = Date.now() - t0;
  const then = entriesFor(P, qid).length ? `slow: handled ${ms} ms later` : alive(st.daemon_pid) ? `still unhandled ${ms} ms later` : `failed: the daemon gone by ${ms} ms later, last-error ${read(path.join(P.run, 'browser', 'last-error'))}`;
  return `${first}; ${then}`;
}
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
  await until(() => entriesFor(P, l.id).length, 20000, 'the close handled')
    .catch(async (e) => { e.message += ` (${await closeState(P, st, l.id)})`; throw e; });
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

// --- a log that can't be read (ruling a-20261122-035321348), on cC. The hook's file makes the view's and
// the watch's reads fail; the hook's limit stands in for the real one, checked here from the code.
const READ = (P, limit, extra = {}) => ({ DEVTEAM_TEST_BROWSER_IDLE_MS: '120000', DEVTEAM_TEST_BROWSER_VIEW_READ_FAILS: path.join(P.home, 'view-read-fails'), DEVTEAM_TEST_BROWSER_READ_FAIL_MS: String(limit), ...extra });
const UNREADABLE = /can't read its log/;

onC('RL0 the limit on failed reads is 10 s', () => {
  const src = fs.readFileSync(new URL('../docs/devteam/scripts/devteam.mjs', import.meta.url), 'utf8');
  assert.match(src, /const BROWSER_READ_FAIL_MS = 10000;/);
});

onC('RL1 failed reads inside the limit: input is dropped, nothing shuts down, and one good read resets the limit', async () => {
  const P = cC();
  const fails = path.join(P.home, 'view-read-fails');
  await ok(P, ['start'], READ(P, 6000));
  const st = readState(P);
  await ok(P, ['open', `${site.origin}/record`]);
  const q = await askHandover(P);
  const v = await nextViewer(P);
  await v.waitFor((m) => m.t === 'held' && m.qid === q, 5000);
  await typeNote(P, marker('rl1-note'), { v });
  // two spells that add up to more than the limit, a good read between them
  for (const spell of ['first', 'second']) {
    fs.writeFileSync(fails, '');
    const dropped = marker(`rl1-${spell}`);
    const t0 = Date.now();
    v.paste(dropped);
    if (spell === 'first') {
      // a socket opened while the log can't be read is told so, never that the supervisor has the
      // browser back: the handover is still open (R3-1)
      const n = await viewSocket(P);
      const b = await n.waitFor((m) => m.t === 'bye', 5000);
      n.close();
      assert.match(b.why, /can't read its log right now/, b.why);
      assert.notEqual(b.why, BACK);
    }
    await sleep(Math.max(0, 3500 - (Date.now() - t0)));
    assert.ok(!landed(dropped), `${spell} spell: input reached the page during failed reads`);
    assert.ok(alive(st.daemon_pid), `${spell} spell: the daemon shut down inside the limit`);
    fs.rmSync(fails, { force: true });
    const back = marker(`rl1-${spell}-back`);
    v.paste(back);
    await until(() => landed(back), 5000, `${spell} spell: input after a good read`);
  }
  assert.ok(!v.msgs.some((m) => m.t === 'bye'), 'a bye inside the limit');
  await withdraw(P, q);
  assert.equal((await waitJson(P)).outcome, 'withdrawn');
  v.close();
  await ok(P, ['stop']);
});

onC('RL2 failed reads held to the limit: the daemon shuts down with its reason, the viewer is told why, and the session is gone', async () => {
  const P = cC();
  const fails = path.join(P.home, 'view-read-fails');
  await ok(P, ['start'], READ(P, 1500));
  const st = readState(P);
  await ok(P, ['open', `${site.origin}/record`]);
  await sessionHolds(P, '/record');
  const q = await askHandover(P);
  const v = await nextViewer(P);
  await v.waitFor((m) => m.t === 'held' && m.qid === q, 5000);
  fs.writeFileSync(fails, '');
  const m = await v.waitFor((o) => o.t === 'bye', 15000);
  assert.match(m.why, UNREADABLE, m.why);
  assert.notEqual(m.why, BACK);
  await until(() => !alive(st.daemon_pid), 20000, 'the daemon gone');
  v.close();
  fs.rmSync(fails, { force: true });
  assert.deepEqual(profilePids(P), [], 'a Chrome left on the profile');
  assert.ok(!fs.readdirSync(path.join(P.profile, 'Default')).includes('Sessions') || !fs.readdirSync(path.join(P.profile, 'Default', 'Sessions')).length, 'the session files are still there');
  const off = await ok(P, ['status']);
  assert.match(off.out, /^last error: \S+ browser: couldn't read the log/m, off.out);
  await ok(P, ['start']);
  await freshViewer(P);
  await withdraw(P, q);
  assert.equal((await waitJson(P)).outcome, 'withdrawn');
  await ok(P, ['stop']);
});

// kit-877: RL2's shutdown (the log unreadable during a handover) with every delete failing: the offline
// status's last error starts with RL2's reason and also says the delete failed, once. KD8 with the
// reaper off (the shutdown's own line); KD8b with it on, read once the reaper has ended (its done hook).
async function unreadableAndUndeletable(P, label, hooks) {
  const fails = path.join(P.home, 'view-read-fails');
  await ok(P, ['stop']);
  await ok(P, ['start'], READ(P, 1500, { DEVTEAM_TEST_BROWSER_DELETE_FAILS: '1', ...hooks }));
  const st = readState(P);
  await ok(P, ['open', `${site.origin}/record`]);
  await sessionHolds(P, '/record');
  const q = await askHandover(P);
  const v = await nextViewer(P);
  await v.waitFor((m) => m.t === 'held' && m.qid === q, 5000);
  fs.writeFileSync(fails, '');
  const m = await v.waitFor((o) => o.t === 'bye', 15000);
  assert.match(m.why, UNREADABLE, m.why);
  await until(() => !alive(st.daemon_pid), 20000, `${label}: the daemon gone`);
  v.close();
  fs.rmSync(fails, { force: true });
  assert.deepEqual(profilePids(P), [], `${label}: a Chrome left on the profile`);
  return q;
}
// the whole line: RL2's reason whole, the join once, the delete's message whole (task 6: a rewrite that cuts
// the reason to fit, as a reaper joining twice would, is caught here, not by the count alone)
const READ_THEN_DELETE = /^last error: \S+ browser: couldn't read the log during a handover, so the session was ended; the session files stay: browser: couldn't delete \S.* \(EACCES\): Chrome would bring its tabs back$/m; // a path may hold a space (Current Session)
const closeAfter = async (P, q) => {
  await ok(P, ['start']);
  await freshViewer(P);
  await withdraw(P, q);
  assert.equal((await waitJson(P)).outcome, 'withdrawn');
  await ok(P, ['stop']);
};
onC('KD8 a failed delete at a shutdown that has its own reason (RL2\'s, the reaper off) is said after that reason', async () => {
  const P = cC();
  const q = await unreadableAndUndeletable(P, 'KD8', { DEVTEAM_TEST_BROWSER_REAP: '0' });
  const off = await ok(P, ['status']);
  assert.match(off.out, READ_THEN_DELETE, off.out);
  await closeAfter(P, q);
});

onC('KD8b the same with the reaper on: its own failed delete adds nothing, so the line says the delete once', async () => {
  const P = cC();
  const done = path.join(P.home, 'reap-done');
  fs.rmSync(done, { force: true });
  const q = await unreadableAndUndeletable(P, 'KD8b', { DEVTEAM_TEST_BROWSER_REAP_DONE: done });
  await until(() => fs.existsSync(done) && fs.readFileSync(done, 'utf8').includes('done'), 15000, 'KD8b: the reaper done');
  const off = await ok(P, ['status']);
  assert.match(off.out, READ_THEN_DELETE, off.out);
  assert.equal(off.out.split("couldn't delete").length - 1, 1, `KD8b: the delete said more than once: ${off.out}`);
  await closeAfter(P, q);
});

onC('RL3 no handover known: an unreadable log changes nothing, frames keep coming and input lands', async () => {
  const P = cC();
  const fails = path.join(P.home, 'view-read-fails');
  const port = ticker.address().port;
  tickerGo = false;
  await ok(P, ['start'], READ(P, 1500, { DEVTEAM_TEST_BROWSER_ALLOW: `${site.port},${port}` }));
  const st = readState(P);
  await ok(P, ['open', `http://127.0.0.1:${port}/`]);
  const v = await nextViewer(P);
  await until(() => framesIn(v.msgs) >= 3, 15000, 'frames before the reads fail');
  fs.writeFileSync(fails, '');
  await sleep(2500); // past the hook's limit
  const n = framesIn(v.msgs);
  await until(() => framesIn(v.msgs) >= n + 3, 15000, 'frames while the log is unreadable');
  assert.ok(alive(st.daemon_pid), 'the daemon shut down with no handover known');
  assert.ok(!v.msgs.some((m) => m.t === 'bye'), 'a bye with no handover known');
  v.close();
  // a new socket isn't refused either, and its input lands
  await ok(P, ['open', `${site.origin}/record`]);
  const w = await nextViewer(P);
  assert.ok(w.msgs.some((m) => m.t === 'held' && m.qid === null));
  await typeNote(P, marker('rl3-note'), { v: w });
  w.close();
  fs.rmSync(fails, { force: true });
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
