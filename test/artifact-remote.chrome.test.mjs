// The Library shows pushes from other machines (kit-750), in Chrome: split out of artifact-remote.test.mjs
// by kit-859, whose header says what is built. Skips where Chrome can't be driven, as the kit's other
// Chrome tests do.
// Ports: none of its own (lib/kit.mjs's freePort)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { write } from './lib/kit.mjs';
import { canDrive, openChrome } from './lib/chrome.mjs';
import { ARTS, sleep, INT, art, within, setup } from './lib/artifact-remote-fixture.mjs';

// ----- in Chrome: the page asks only from the Library or a stage; the viewer reloads by itself on main and on a remote
// draft; the Library's cards and sentences -----
const PAGE = `(() => {
  window.__titles = [];
  window.__hidden = false;
  Object.defineProperty(Document.prototype, 'visibilityState', { configurable: true, get() { return window.__hidden ? 'hidden' : 'visible'; } });
  addEventListener('message', (e) => { const fr = document.getElementById('av-frame'); if (fr && e.source === fr.contentWindow && e.data?.lens === 1 && e.data.type === 'ready') window.__titles.push(e.data.title); });
})();`;

test('artifact remote main: in Chrome, the page asks only from the Library or a stage, a viewer reloads to a push, and the Library shows cards, drafts and stale', { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket', timeout: 900000 }, async (t) => {
  const { F, spy, other, start, later } = await setup(t, 'remote-chrome', { DEVTEAM_ARTIFACT_FETCH_BACKOFF_MS: '8000', DEVTEAM_ARTIFACT_FETCH_TIMEOUT_MS: '2000' });
  other.push('main', 'remote-main', art('v1'));
  other.push('ticket/two-a', 'two-mock', art('two a'));
  await sleep(1100);
  other.push('ticket/two-b', 'two-mock', art('two b'));
  F.g(['pull', '-q', 'origin', 'main'], F.old);
  const { B, L, P, V, W } = await start();
  const chrome = await openChrome();
  later(() => chrome.close());
  const p = await chrome.newPage();
  later(() => p.close());
  await p.send('Page.enable');
  await p.send('Runtime.enable');
  await p.send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 800, deviceScaleFactor: 1, mobile: false });
  await p.send('Page.addScriptToEvaluateOnNewDocument', { source: PAGE });
  const soon = async (ms, expr, what) => within(ms, async () => p.ev(expr), what);
  const go = async (url) => { await p.send('Page.navigate', { url: 'about:blank' }); await soon(10000, `location.href === 'about:blank'`, 'about:blank'); await p.send('Page.navigate', { url }); };
  // M1b: the dashboard on another page, no stage: no fetch; the Library hidden: none; the Library seen: one
  await go(`${B}/#overview`);
  await soon(30000, `typeof PAGE_NOW === 'string' && PAGE_NOW !== 'library' && typeof DATA === 'object' && !!DATA`, 'M1b: the dashboard drawn');
  await sleep(INT * 3 + W);
  assert.deepEqual(spy.fetches(), [], 'M1b: no fetch from a page that is not the Library and shows no stage');
  await p.ev('(window.__hidden = true, location.hash = "#library", true)');
  await soon(10000, `PAGE_NOW === 'library'`, 'M1b: on the Library, hidden');
  await sleep(INT * 3 + W);
  assert.deepEqual(spy.fetches(), [], 'M1b: no fetch from a hidden Library');
  await p.ev('(window.__hidden = false, document.dispatchEvent(new Event("visibilitychange")), true)');
  await within(INT + 11000, async () => spy.fetches().length > 0, 'M1b: a fetch once the Library is seen');
  // M5 + D7: the Library, a new landed card and a draft from another machine, without a reload of the page
  await p.ev('(window.__loaded = true)');
  other.push('main', 'new-card', art('New card'));
  other.push('ticket/far-02', 'far-card', art('Far card'));
  await soon(P, `!!document.querySelector('[data-lib-id="artifact:new-card"]')`, 'M5: the pushed card');
  const card = await soon(P, `(() => { const c = document.querySelector('[data-lib-id="artifact:far-card"]'); return c && c.textContent; })()`, 'D7: the draft card');
  assert.match(card, /from another machine/, 'D7: says it is from another machine');
  assert.match(card, /ticket\/far-02/, 'D7: names its branch');
  assert.equal(await p.ev('window.__loaded === true'), true, 'M5: no reload of the page');
  // D9: the card opens the newer branch's copy
  const href = await p.ev(`(() => { const a = document.querySelector('[data-lib-id="artifact:two-mock"] a.lib-title'); return a && (a.getAttribute('href') || ''); })()`);
  assert.match(decodeURIComponent(href ?? ''), /two-b/, `D9: the card opens two-b's draft (${href})`);
  // D7: opened, it frames the branch's route
  await p.ev(`(document.querySelector('[data-lib-id="artifact:far-card"] a.lib-title').click(), true)`);
  await soon(30000, `document.getElementById('av-frame')?.getAttribute('src')?.startsWith('/artifact/origin/ticket%2Ffar-02/far-card/') && window.__titles.includes('Far card')`, 'D7: framed from the branch');
  // D11: a viewer on the remote draft reloads by itself after a push changes it
  await go(`${B}/view/artifact/far-card?at=${encodeURIComponent('origin:ticket/far-02')}`);
  await soon(30000, `window.__titles.includes('Far card')`, 'D11: the remote draft framed');
  other.push('ticket/far-02', 'far-card', art('Far card 2'));
  await soon(INT + 2000 + 5000 + 5000, `window.__titles.includes('Far card 2')`, 'D11: the viewer reloaded to the new push by itself');
  // M4: a viewer on main, a push of v2 to origin's main, the frame on v2 with no click
  await go(`${B}/view/artifact/remote-main`);
  await soon(30000, `window.__titles.includes('v1')`, 'M4: v1 framed');
  other.push('main', 'remote-main', art('v2'));
  await soon(V, `window.__titles.includes('v2')`, 'M4: the viewer reloaded to v2 by itself');
  // D6: a local worktree draft of the same slug wins and says so
  await go(`${B}/#library`);
  for (const [rel, text] of Object.entries(art('Local far'))) write(path.join(F.old, '.worktrees/far-02', ARTS, 'far-card', rel), text);
  await soon(P, `(() => { const c = document.querySelector('[data-lib-id="artifact:far-card"]'); return c && /Also pushed from another machine on ticket\\/far-02/.test(c.textContent); })()`, 'D6: the local card says so');
  // S3: a failing fetch puts the stale sentence at the Library's top, without git's words, and a good one takes it away
  spy.hang(true);
  const said = await soon(L + 10000, `(() => { const e = document.getElementById('lib-top'); return !e.hidden && /may be out of date/.test(e.textContent) && /couldn't reach/.test(e.textContent) && e.textContent; })()`, 'S3: stale said in the Library');
  assert.doesNotMatch(said, /fatal|error:|refs\/|\.git\b/i, "S3: git's own words are not in the sentence");
  spy.hang(false);
  await soon(8000 + L + 10000, `!/may be out of date/.test(document.getElementById('lib-top').textContent)`, 'S3: stale gone after a good fetch');
});
