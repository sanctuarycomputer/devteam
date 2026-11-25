// kit-914: a call the test browser gives no answer still fails at 30 s, once, and now says what Chrome
// was doing: the tab, a JS dialog open on it or another tab, what its socket last heard, whether the
// page answers a second session, each renderer's CPU, and, when Chrome answers nothing at all, each
// look's own "no answer" within a bound (docs/devteam/project/tickets/kit-914-chrome-no-answer-ci/spec.md, home).
// The three cases wait 30 s each, so they run at once, each with its own Chrome.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canDrive, openChrome } from './lib/chrome.mjs';

// a call's error and how long it took to come
const failing = async (call) => { const t = Date.now(); const e = await call.then(() => null, (x) => x); return { e, ms: Date.now() - t }; };
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
        assert.match(ra.e.message, /^Runtime\.evaluate: no answer from Chrome in 30 s; tab [0-9A-F]{8} at about:blank; /);
        assert.match(ra.e.message, /; an alert dialog \("held here", at about:blank\) open on this tab for \d+\.\d s; /);
        const tab = ra.e.message.match(/; tab ([0-9A-F]{8}) /)[1];
        assert.match(rb.e.message, new RegExp(`; an alert dialog \\("held here", at about:blank\\) open on tab ${tab} for `), 'the other tab names the dialog on the held one');
        assert.match(ra.e.message, /; last heard on its socket: [^;]*an alert dialog \d+\.\d s ago/);
        assert.match(ra.e.message, /; Chrome running; /);
        assert.match(ra.e.message, /; its page gives a second session no answer in 2 s(; |$)/);
        assert.match(rb.e.message, /; renderers: \d+ (\d+% cpu|new)(, \d+ (\d+% cpu|new))*$/);
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
  ]);
});
