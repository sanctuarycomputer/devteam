// kit-914: a call the test browser gives no answer still fails at 30 s, once, and now says what Chrome
// was doing: the tab, a JS dialog open on it or another tab, what its socket last heard, whether the
// page answers a second session, each renderer's CPU, and, when Chrome answers nothing at all, each
// look's own "no answer" within a bound (docs/devteam/project/tickets/kit-914-chrome-no-answer-ci/spec.md, home).
// The three cases wait 30 s each, so they run at once, each with its own Chrome.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canDrive, openChrome, processesOf } from './lib/chrome.mjs';
import fs from 'node:fs';
import { closeTab, oneTab } from './fixtures/artifact-viewer/harness.mjs';

// a call's error and how long it took to come
const failing = async (call) => { const t = Date.now(); const e = await call.then(() => null, (x) => x); return { e, ms: Date.now() - t }; };
// What follows "Chrome running; " in a diagnosis, in each form chrome.mjs gives (kit-918): the second-session line and
// the renderers line (each may say its own look ran out its bound); or the whole look cut at 6 s, after the
// second-session line or before it; or Chrome's endpoint unreachable, in place of both. ss: the second-session
// forms this tab may give. Anything else in that place is refused.
const RENDERERS = String.raw`renderers: (\d+ (\d+% cpu|new)(, \d+ (\d+% cpu|new))*|no process info)`;
const CUT = 'diagnosis cut at 6 s';
const ENDPOINT = String.raw`Chrome's endpoint: (no answer in 2 s|could not reach it)`;
const HELD = String.raw`(its page gives a second session no answer in 2 s|a second session: no answer in 1 s)`;
const ANY = String.raw`(its page answers a second session in \d+ ms|${HELD})`;
const looks = (ss) => new RegExp(`; Chrome running; (${ss}; ${RENDERERS}|${ss}; ${CUT}|${CUT}|${ENDPOINT})$`);
// one process (kit-930): its type, pid, state (letter and word) and CPU, or what of it was not read
const TYPE = String.raw`(browser|zygote|GPU|network|storage|renderer|utility \S+|[a-z-]+|type unread)`;
const ROW = String.raw`${TYPE} \d+ ([A-Za-z] [a-z]+ (\d+% cpu|cpu unread)|state unread|gone)`;
const PROCESSES = String.raw`processes: ((${ROW}(, ${ROW})*|none found)(, cut at 4 s)?|no /proc here|the list of processes: [^;]*)`;
// What the test itself reads of a Chrome's processes, to check the line against, whatever build of Chrome this is:
// each pid's type by the spec's table (kit-930) from its own /proc/<pid>/cmdline, null once it is gone.
const typeSeen = (pid) => {
  let cmd;
  try { cmd = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8'); } catch { return null; }
  const type = cmd.match(/--type=([^\s\0]+)/)?.[1];
  if (!type) return 'browser';
  if (type === 'gpu-process') return 'GPU';
  if (type !== 'utility') return type;
  const sub = cmd.match(/--utility-sub-type=([^\s\0]+)/)?.[1] ?? '';
  return { 'network.mojom.NetworkService': 'network', 'storage.mojom.StorageService': 'storage' }[sub] ?? (sub ? `utility ${sub.split('.').pop()}` : 'utility');
};
// a processes line's rows as [type, pid, the rest]
const rowsOf = (line) => line.replace(/^processes: /, '').split(', ').map((row) => row.match(/^(.+?) (\d+) (.+)$/)).map((m) => m && [m[1], Number(m[2]), m[3]]);
// a look past its own bound (a loaded runner): said so, and logged, not failed (kit-918)
const OUT_OF_BOUND = /unread|cut at 4 s|the list of processes: (ps: )?no answer/;
// the pids in this Chrome's process group, by the test's own read of /proc
const groupOf = (pgid) => fs.readdirSync('/proc').filter((d) => /^\d+$/.test(d)).filter((d) => { try { const st = fs.readFileSync(`/proc/${d}/stat`, 'utf8'); return Number(st.slice(st.lastIndexOf(')') + 2).split(' ')[2]) === pgid; } catch { return false; } }).map(Number);
// a tab busy until a set time, whenever its evaluation starts (behind another tab's dialog in the same renderer, or not)
const busy = (p, until) => failing(p.send('Runtime.evaluate', { expression: `for (;Date.now() < ${until};) {} 1` }));

test('a call with no answer says what Chrome was doing', { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket', timeout: 150000, concurrency: true }, async (t) => {
  await Promise.all([
    t.test('a call held by a dialog, and one on another tab of that browser, say so', async () => {
      const chrome = await openChrome();
      try {
        const held = await chrome.newPage();
        const other = await chrome.newPage();
        await held.send('Page.enable');
        await other.send('Page.enable');
        // the held tab counts its evaluations of this, so a second send of it would show
        const a = failing(held.send('Runtime.evaluate', { expression: 'window.__n = (window.__n || 0) + 1; if (window.__n === 1) alert("held here"); 1' }));
        await new Promise((r) => setTimeout(r, 500));
        const until = Date.now() + 34000;
        const b = busy(other, until);
        const [ra, rb] = await Promise.all([a, b]);
        assert.ok(ra.e && rb.e, 'both calls fail');
        // the 30 s as it was, the diagnosis after it bounded: never a second wait, never sooner
        assert.ok(ra.ms >= 30000 && ra.ms < 36500, `took ${ra.ms} ms`);
        assert.match(ra.e.message, /^Runtime\.evaluate: no answer from Chrome in 30 s; tab [0-9A-F]{8} (at about:blank|\(Chrome's list of tabs: no answer in 2 s\)); /);
        assert.match(ra.e.message, /; an alert dialog \("held here", at about:blank\) open on this tab for \d+\.\d s; /);
        const tab = ra.e.message.match(/; tab ([0-9A-F]{8}) /)[1];
        assert.match(rb.e.message, new RegExp(`; an alert dialog \\("held here", at about:blank\\) open on tab ${tab} for `), 'the other tab names the dialog on the held one');
        assert.match(ra.e.message, /; last heard on its socket: [^;]*an alert dialog \d+\.\d s ago/);
        assert.match(ra.e.message, /; Chrome running; /);
        // On a loaded runner a look can run out its own bound, the whole look the 6 s cut, or Chrome's endpoint its 2 s
        // (kit-918): each line is then the form that says so, and never a wrong one. The held page never answers the second session.
        assert.match(ra.e.message, looks(HELD));
        assert.match(rb.e.message, looks(ANY));
        for (const r of [ra, rb]) if (/renderers: no process info|a second session: no answer|Chrome's list of tabs: no answer|diagnosis cut at 6 s|Chrome's endpoint: /.test(r.e.message)) t.diagnostic(`a look ran out its bound: ${r.e.message.slice(r.e.message.indexOf('; Chrome '))}`);
        // answered by the test, the page goes on: the held call ran once
        await held.send('Page.handleJavaScriptDialog', { accept: true });
        await new Promise((r) => setTimeout(r, Math.max(500, until - Date.now() + 500)));
        assert.equal(await held.ev('window.__n'), 1, 'the held call was sent once');
      } finally { await chrome.close(); }
    }),
    t.test('a dialog on a tab whose socket was dropped is still named while the tab is there', async () => {
      const chrome = await openChrome();
      try {
        const left = await chrome.newPage();
        await left.send('Page.enable');
        await left.send('Runtime.evaluate', { expression: 'setTimeout(() => alert("left open")); 1' });
        // the dialog up (and its event here): the page stops answering; a call left waiting fails when the socket closes
        let up = false;
        for (let i = 0; i < 30 && !up; i++) up = !(await Promise.race([left.send('Runtime.evaluate', { expression: '1' }).then(() => true, () => true), new Promise((r) => setTimeout(() => r(false), 1000))]));
        assert.ok(up, 'the alert is up');
        // this side lets go of the tab (as a test that gave up on it does); the tab and its dialog stay
        left.close();
        const other = await chrome.newPage();
        const r = await busy(other, Date.now() + 34000);
        assert.ok(r.e, 'the call fails');
        assert.match(r.e.message, /; an alert dialog \("left open", at about:blank\) open on tab [0-9A-F]{8} for \d+\.\d s; /);
      } finally { await chrome.close(); }
    }),
    t.test('a browser that answers nothing still fails the call soon, each look saying so', async () => {
      const chrome = await openChrome();
      try {
        const p = await chrome.newPage();
        process.kill(-chrome.pid, 'SIGSTOP');
        let r;
        try { r = await failing(p.send('Runtime.evaluate', { expression: '1' })); } finally { process.kill(-chrome.pid, 'SIGCONT'); }
        assert.ok(r.ms >= 30000 && r.ms < 36500, `took ${r.ms} ms`);
        assert.match(r.e.message, /^Runtime\.evaluate: no answer from Chrome in 30 s; tab [0-9A-F]{8} \(Chrome's list of tabs: no answer in 2 s\); last heard on its socket: nothing; Chrome running; Chrome's endpoint: no answer in 2 s$/);
      } finally { await chrome.close(); }
    }),
    // kit-930: which process holds is what the line is for: one stopped alone is the one named stopped. The storage
    // service, else the network service, else the GPU process: whichever this Chrome has, by the test's own read.
    t.test('a Chrome process stopped alone is named stopped, by its type, and the others are not', async () => {
      const chrome = await openChrome();
      try {
        const p = await chrome.newPage();
        await p.send('Page.navigate', { url: 'data:text/html,<p>here' });
        let target;
        for (let i = 0; i < 100 && !target; i++) {
          const types = new Map(groupOf(chrome.pid).map((pid) => [typeSeen(pid), pid]));
          target = ['storage', 'network', 'GPU'].filter((x) => types.has(x)).map((x) => [x, types.get(x)])[0];
          if (!target) await new Promise((r) => setTimeout(r, 100));
        }
        assert.ok(target, 'setup: Chrome has a storage service, a network service or a GPU process');
        const [type, pid] = target;
        process.kill(pid, 'SIGSTOP');
        let line;
        try { line = await processesOf(chrome.pid); } finally { process.kill(pid, 'SIGCONT'); }
        assert.match(line, new RegExp(`^${PROCESSES}$`));
        if (OUT_OF_BOUND.test(line)) return t.diagnostic(`a look ran out its bound: ${line}`);
        assert.match(line, new RegExp(`(: |, )${type} ${pid} T stopped 0% cpu(, |$)`), line);
        assert.equal(line.match(/ T stopped /g).length, 1, `only the ${type} stopped: ${line}`);
        assert.ok(rowsOf(line).some(([t]) => t === 'browser'), `the browser named: ${line}`);
      } finally { await chrome.close(); }
    }),
    // kit-918: the artifact viewer's harness closes each case's tab with closeTab (Page.close runs the page's beforeunload)
    t.test('a tab close the page holds with a dialog fails its caller, saying what Chrome was doing', async () => {
      const chrome = await openChrome();
      try {
        const p = await chrome.newPage();
        await p.send('Page.enable');
        // the page always asks before it goes; a user gesture lets it ask
        await p.send('Runtime.evaluate', { expression: "addEventListener('beforeunload', (e) => { e.preventDefault(); e.returnValue = ''; }); 1", userGesture: true });
        const r = await failing(closeTab(p));
        assert.ok(r.e, 'the close fails');
        assert.ok(r.ms >= 30000 && r.ms < 36500, `took ${r.ms} ms`);
        assert.match(r.e.message, /^closing the tab: still open after Page\.close; Runtime\.evaluate: no answer from Chrome in 30 s; tab [0-9A-F]{8} (at about:blank|\(Chrome's list of tabs: no answer in 2 s\)); a beforeunload dialog \("", at about:blank\) open on this tab for \d+\.\d s; /);
        if (/Chrome's list of tabs: no answer/.test(r.e.message)) t.diagnostic(`a look ran out its bound: ${r.e.message.slice(r.e.message.indexOf('; tab '))}`);
      } finally { await chrome.close(); }
    }),
    t.test('a tab still saving is closed once the save ends, with no dialog', async () => {
      const chrome = await openChrome();
      try {
        for (const late of [0, 150, 300]) {
          const p = await chrome.newPage();
          await p.send('Page.enable');
          // the dashboard's guard (index.html's SAVING and beforeunload), the save ending 1.5 s on; the floor counts from began, the page's own clock
          const began = (await p.send('Runtime.evaluate', { expression: "var SAVING = 1; addEventListener('beforeunload', (e) => { if (SAVING) { e.preventDefault(); e.returnValue = ''; } }); var began = Date.now(); setTimeout(() => { SAVING = 0; }, 1500); began", userGesture: true, returnByValue: true })).result.value;
          if (late) await new Promise((r) => setTimeout(r, late));
          const r = await failing(closeTab(p));
          assert.equal(r.e, null, `the close succeeds (${late} ms late)`);
          const since = Date.now() - began;
          assert.ok(since >= 1400 && r.ms < 10000, `closed ${since} ms after the save began (the close ${late} ms late); the close took ${r.ms} ms`);
        }
      } finally { await chrome.close(); }
    }),
    t.test('a tab saving past the bound fails its close, saying so, and opens no dialog', async () => {
      const chrome = await openChrome();
      try {
        const p = await chrome.newPage();
        await p.send('Page.enable');
        await p.send('Runtime.evaluate', { expression: "var SAVING = 2; addEventListener('beforeunload', (e) => { if (SAVING) { e.preventDefault(); e.returnValue = ''; } }); 1", userGesture: true });
        const r = await failing(closeTab(p, { saving: 1000 }));
        assert.ok(r.e, 'the close fails');
        assert.ok(r.ms < 5000, `took ${r.ms} ms`);
        assert.equal(r.e.message, 'closing the tab: the page still saving (SAVING 2) after 1 s; closing it would open its beforeunload dialog');
      } finally { await chrome.close(); }
    }),
  ]);
});

// kit-918: closeTab's order and bounds, on a page of its own making (no Chrome): what it was asked, and what it says.
const fakePage = (answer) => { const asked = []; return { asked, ev: async (x) => { asked.push(`ev ${x}`); return 0; }, send: async (m) => { asked.push(m); return answer(m, asked); }, close: () => asked.push('socket closed') }; };
const gone = () => { throw new Error("Runtime.evaluate: Chrome's page connection closed (code 1006)"); };
test('closeTab: nothing saving, closed, then called until its socket closes', async () => {
  const p = fakePage((m, asked) => (m === 'Runtime.evaluate' && asked.filter((a) => a === m).length === 2 ? gone() : {}));
  await closeTab(p);
  assert.deepEqual(p.asked, ["ev typeof SAVING === 'number' ? SAVING : 0", 'Page.close', 'Runtime.evaluate', 'Runtime.evaluate', 'socket closed']);
});
test('closeTab: a tab still answering after Page.close fails its caller, saying so', async () => {
  const p = fakePage(() => ({}));
  await assert.rejects(closeTab(p, { gone: 300 }), { message: 'closing the tab: still open 0.3 s after Page.close' });
  assert.equal(p.asked.at(-1), 'socket closed');
});
test('closeTab: an error from Page.close other than the socket closing fails its caller', async () => {
  const p = fakePage((m) => { if (m === 'Page.close') throw new Error('Page.close: Not attached to an active page'); return {}; });
  await assert.rejects(closeTab(p), { message: 'closing the tab: Page.close: Not attached to an active page' });
  assert.equal(p.asked.at(-1), 'socket closed');
});
test('the harness closes each case\'s tab with closeTab: the last one before the next, and the last at the end', async () => {
  const pages = [];
  const chrome = { newPage: async () => { const p = fakePage((m, asked) => (m === 'Runtime.evaluate' ? gone() : {})); pages.push(p); return p; } };
  const tabs = oneTab(chrome);
  const a = await tabs.next();
  assert.deepEqual(a.asked, [], 'a new tab is not closed');
  const b = await tabs.next();
  assert.deepEqual(a.asked, ["ev typeof SAVING === 'number' ? SAVING : 0", 'Page.close', 'Runtime.evaluate', 'socket closed'], 'the last tab closed by closeTab before the next');
  assert.deepEqual(b.asked, []);
  await tabs.done();
  assert.deepEqual(b.asked.slice(-2), ['Runtime.evaluate', 'socket closed'], 'the last tab closed at the end');
  await tabs.done();
  assert.equal(pages.length, 2);
  // visit and the teardown take their tabs from oneTab, and nothing else in the harness closes a tab
  const src = fs.readFileSync(new URL('./fixtures/artifact-viewer/harness.mjs', import.meta.url), 'utf8');
  assert.equal(src.match(/'Page\.close'/g).length, 1, "the harness sends Page.close only in closeTab");
  assert.equal(src.match(/chrome\.newPage\(\)/g).length, 1, 'the harness opens a tab only in oneTab');
  assert.match(src, /const tabs = oneTab\(chrome\);\n  later\(\(\) => tabs\.done\(\)\);/);
  assert.match(src, /async function visit\([^)]*\) \{\n    const p = await tabs\.next\(\);/);
});
test('a diagnosis\'s last looks: each form chrome.mjs gives is taken, anything else in their place refused', () => {
  const at = (tail) => `Runtime.evaluate: no answer from Chrome in 30 s; tab 0123ABCD at about:blank; last heard on its socket: nothing; Chrome running; ${tail}`;
  for (const tail of ['its page gives a second session no answer in 2 s; renderers: 12 0% cpu, 34 new', 'a second session: no answer in 1 s; renderers: no process info', 'its page gives a second session no answer in 2 s; diagnosis cut at 6 s', 'diagnosis cut at 6 s', "Chrome's endpoint: no answer in 2 s", "Chrome's endpoint: could not reach it"]) assert.match(at(tail), looks(HELD), tail);
  assert.match(at('its page answers a second session in 3 ms; renderers: 12 100% cpu'), looks(ANY));
  for (const tail of ['its page answers a second session in 3 ms; renderers: 12 0% cpu', 'its page gives a second session no answer in 2 s', 'renderers: 12 0% cpu', 'its page gives a second session no answer in 2 s; renderers: garbled', 'garbled; diagnosis cut at 6 s', 'its page gives a second session no answer in 2 s; renderers: 12 0% cpu; diagnosis cut at 6 s', "Chrome's endpoint: something else", "Chrome's endpoint: no answer in 2 s; renderers: 12 0% cpu", 'its page gives a second session no answer in 2 s; renderers: none']) assert.doesNotMatch(at(tail), looks(HELD), tail);
});
test('closeTab: a tab whose SAVING read gets no answer fails its caller at once, and is never sent Page.close', async () => {
  const held = 'Runtime.evaluate: no answer from Chrome in 30 s; tab 0123ABCD at about:blank; a beforeunload dialog ("", at about:blank) open on this tab for 30.0 s';
  const p = fakePage(() => ({}));
  p.ev = async (x) => { p.asked.push(`ev ${x}`); throw new Error(held); };
  await assert.rejects(closeTab(p), { message: `closing the tab: ${held}` });
  assert.deepEqual(p.asked, ["ev typeof SAVING === 'number' ? SAVING : 0", 'socket closed']);
});
// kit-930: processesOf on a machine of the test's own making (no Chrome): what it reads, at most two reads at once, each bounded.
// tree: pid -> { pgrp, state, state2, ticks, ticks2, cmdline, hang: 'stat'|'cmdline'|'stat2', gone2 }; ms: each read's delay; hang: 'list' too
// release() settles every read held so far, giving its place back (the places are the module's, shared by every call)
const fakeProc = (tree, { ms = 2, hang, seen = { now: 0, max: 0 } } = {}) => {
  seen.stats = new Map();
  const held = [];
  const slow = (f) => { seen.now++; seen.max = Math.max(seen.max, seen.now); return new Promise((ok, no) => setTimeout(() => { seen.now--; try { ok(f()); } catch (e) { no(e); } }, ms)); };
  const never = () => { seen.now++; seen.max = Math.max(seen.max, seen.now); return new Promise((ok) => held.push(() => { seen.now--; ok(''); })); };
  const enoent = () => Object.assign(new Error('ENOENT: gone'), { code: 'ENOENT' });
  const io = {
    proc: true,
    list: () => (hang === 'list' ? never() : slow(() => Object.entries(tree).map(([pid, x]) => [Number(pid), x.pgrp ?? 7]))),
    readFile: (p) => {
      const [, pid, file] = p.match(/^\/proc\/(\d+)\/(stat|cmdline)$/);
      const x = tree[pid];
      if (file === 'cmdline') return x.hang === 'cmdline' ? never() : slow(() => x.cmdline ?? '');
      const n = (seen.stats.get(pid) ?? 0) + 1;
      seen.stats.set(pid, n);
      if (x.hang === (n === 1 ? 'stat' : 'stat2')) return never();
      return slow(() => { if (n > 1 && x.gone2) throw enoent(); return `${pid} (chrome (x)) ${(n > 1 && x.state2) || x.state || 'S'} 1 ${x.pgrp ?? 7} 7 0 -1 0 0 0 0 0 ${n === 1 ? x.ticks ?? 0 : x.ticks2 ?? x.ticks ?? 0} 0 20 0`; });
    },
  };
  return { io, seen, release: () => held.splice(0).forEach((f) => f()) };
};
const CMD = { browser: '/usr/lib/chromium/chromium\0--headless=new\0about:blank\0', zygote: 'chromium --type=zygote --no-sandbox', GPU: 'chromium --type=gpu-process --no-sandbox', network: 'chromium --type=utility --utility-sub-type=network.mojom.NetworkService --lang=en-US', storage: 'chromium --type=utility --utility-sub-type=storage.mojom.StorageService', audio: 'chromium --type=utility --utility-sub-type=audio.mojom.AudioService', utility: 'chromium --type=utility --lang=en-US', renderer: 'chromium --type=renderer --js-flags=--max-old-space-size=256' };
test('processesOf: each process of the group, by its type, with its state and CPU; never one outside it', async () => {
  const { io } = fakeProc({
    7: { cmdline: CMD.browser, ticks: 5, ticks2: 15 }, 8: { cmdline: CMD.zygote }, 9: { cmdline: CMD.GPU, state: 'D' }, 10: { cmdline: CMD.network, state: 'R' },
    11: { cmdline: CMD.storage, state: 'S', state2: 'T' }, 12: { cmdline: CMD.audio }, 13: { cmdline: CMD.renderer, state: 'Z' }, 14: { cmdline: CMD.renderer, gone2: true }, 15: { cmdline: CMD.utility },
    40: { pgrp: 99, cmdline: CMD.renderer },
  });
  const t0 = Date.now();
  const line = await processesOf(7, { io, window: 100 });
  assert.ok(Date.now() - t0 >= 100, 'the CPU is read over the window');
  const cpu = Number(line.match(/^processes: browser 7 S sleeping (\d+)% cpu, /)?.[1]);
  // 10 ticks of 10 ms over a window of about 100 ms: about 100%
  assert.ok(cpu >= 40 && cpu <= 110, `the browser's CPU from its ticks: ${line}`);
  assert.equal(line.replace(/^processes: browser 7 S sleeping \d+% cpu, /, ''), 'zygote 8 S sleeping 0% cpu, GPU 9 D uninterruptible 0% cpu, network 10 R running 0% cpu, storage 11 T stopped 0% cpu, utility AudioService 12 S sleeping 0% cpu, renderer 13 Z zombie 0% cpu, renderer 14 gone, utility 15 S sleeping 0% cpu');
});
test('processesOf: never more than two reads at once', async () => {
  const tree = {};
  for (let pid = 100; pid < 160; pid++) tree[pid] = { pgrp: pid % 4 ? 3 : 7, cmdline: CMD.renderer };
  const { io, seen } = fakeProc(tree, { ms: 3 });
  const line = await processesOf(7, { io, window: 20 });
  assert.equal(seen.max, 2, `at most two reads at once (${seen.max} seen)`);
  assert.equal(line.match(/renderer \d+ S sleeping 0% cpu/g)?.length, 15, line);
});
test('processesOf: a read that never ends keeps its place, so two held reads never make a third; the look ends at its bound, saying what was not read', async (t) => {
  const { io, seen, release } = fakeProc({ 7: { cmdline: CMD.browser }, 8: { cmdline: CMD.zygote, hang: 'cmdline' }, 9: { cmdline: CMD.renderer, hang: 'stat' }, 10: { cmdline: CMD.renderer } });
  t.after(release);
  const t0 = Date.now();
  // its own bound on the look's, so a look with none fails here rather than leaving the test unsettled
  const line = await Promise.race([processesOf(7, { io, each: 100, window: 50, total: 600 }), new Promise((r) => setTimeout(() => r('still looking at 2 s'), 2000))]);
  const ms = Date.now() - t0;
  assert.equal(seen.max, 2, `two held reads, never a third read beside them (${seen.max} at once)`);
  assert.ok(ms >= 600 && ms < 900, `ended at its bound: ${ms} ms`);
  assert.equal(line, 'processes: browser 7 S sleeping cpu unread, type unread 8 S sleeping cpu unread, type unread 9 state unread, type unread 10 state unread, cut at 0.6 s');
});
test('processesOf: one read that never ends is given up on in its time, and the rest are read', async (t) => {
  const { io, seen, release } = fakeProc({ 7: { cmdline: CMD.browser }, 8: { cmdline: CMD.zygote, hang: 'cmdline' }, 9: { cmdline: CMD.renderer }, 10: { cmdline: CMD.renderer } });
  t.after(release);
  const t0 = Date.now();
  const line = await processesOf(7, { io, each: 100, window: 50, total: 2000 });
  assert.ok(Date.now() - t0 < 1000, 'well inside its bound');
  assert.equal(seen.max, 2);
  assert.equal(line, 'processes: browser 7 S sleeping 0% cpu, type unread 8 S sleeping 0% cpu, renderer 9 S sleeping 0% cpu, renderer 10 S sleeping 0% cpu');
});
test('processesOf: a list that never comes, fails, or finds none, and no /proc, each say so', async (t) => {
  const t0 = Date.now();
  const never = fakeProc({}, { hang: 'list' });
  t.after(never.release);
  assert.equal(await processesOf(7, { io: never.io, each: 100, total: 600 }), 'processes: the list of processes: no answer in 0.2 s');
  assert.ok(Date.now() - t0 < 500, 'the list given up on in its time');
  assert.equal(await processesOf(7, { io: { proc: true, list: async () => { throw new Error('ps: spawn ps ENOENT'); }, readFile: async () => '' } }), 'processes: the list of processes: ps: spawn ps ENOENT');
  assert.equal(await processesOf(7, { io: fakeProc({ 1: { pgrp: 1 } }).io, window: 10 }), 'processes: none found');
  assert.equal(await processesOf(7, { io: { proc: false } }), 'processes: no /proc here');
});
test('processesOf: calls at once share the two places; held reads hold them across calls until they settle, and then the next call reads', async (t) => {
  const seen = { now: 0, max: 0 };
  const a = fakeProc({ 7: { cmdline: CMD.browser }, 8: { cmdline: CMD.zygote, hang: 'cmdline' }, 9: { cmdline: CMD.renderer, hang: 'cmdline' } }, { seen });
  const b = fakeProc({ 20: { pgrp: 20, cmdline: CMD.browser }, 21: { pgrp: 20, cmdline: CMD.renderer } }, { seen });
  t.after(a.release);
  const [la, lb] = await Promise.all([processesOf(7, { io: a.io, each: 100, window: 50, total: 600 }), processesOf(20, { io: b.io, each: 100, window: 50, total: 600 })]);
  assert.equal(seen.max, 2, `two reads in flight across both calls (${seen.max} at once)`);
  assert.match(la, /, cut at 0\.6 s$/, la);
  // b's reads wait behind a's two held ones, so b too is cut at its bound, saying what it did not read
  assert.match(lb, /^processes: (browser|type unread) 20 .*, cut at 0\.6 s$/, lb);
  a.release();
  await new Promise((r) => setTimeout(r, 20));
  const c = fakeProc({ 30: { pgrp: 30, cmdline: CMD.browser } });
  assert.equal(await processesOf(30, { io: c.io, window: 20 }), 'processes: browser 30 S sleeping 0% cpu', 'once they settle, the places are free again');
});
