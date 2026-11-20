// The viewer in Chrome: the artifact lens beside a page's own scripts, a frame of the dashboard's own origin, the stage.
// Ports: none of its own (lib/kit.mjs's +0 hub, +1..25)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { kit, freePort, dashboardOnFreePort, until, threadsFixture } from './lib/kit.mjs';
import { canDrive, cleanup, openChrome } from './lib/chrome.mjs';
import { soonIn, landArtifact, VIEWER_MOCK, COUNT_FETCH } from './lib/dashboard-page.mjs';

test('the artifact lens in Chrome: a framed artifact\'s own inline scripts run beside it, under the policy as it was', { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket', timeout: 180000 }, async (t) => {
  const later = cleanup(t);
  const F = threadsFixture('artifact-lens-chrome');
  later(() => F.done());
  // its own inline scripts, in the head and the body, and one that answers its parent itself
  landArtifact(F, 'inline-mock', {
    'artifact.json': JSON.stringify({ v: 1, title: 'Inline mock', summary: 'A page with its own scripts', by: 'supervisor', for: [] }),
    'index.html': '<!doctype html><html><head><title>Inline mock</title><script>window.blocked = []; addEventListener("securitypolicyviolation", (e) => { window.blocked.push(e.violatedDirective); }); document.title = "Retitled by its own script";</script></head>'
      + '<body style="margin:0"><p id="art" style="margin:0;padding:20px">the mock</p><p id="share" style="margin:0;padding:20px">http://box.example/c/1.abc.def/artifact/main/inline-mock/</p><script>document.getElementById("art").dataset.ran = "yes"; addEventListener("message", (e) => { if (e.data && e.data.ask === "own") parent.postMessage({ own: 1, ran: document.getElementById("art").dataset.ran, blocked: window.blocked }, "*"); });</script></body></html>',
  });
  const { dash, port } = await dashboardOnFreePort(F.old, F.env({}));
  const B = `http://127.0.0.1:${port}`;
  later(() => dash.stop());
  const chrome = await openChrome();
  later(() => chrome.close());
  const p = await chrome.newPage();
  later(() => p.close());
  await p.send('Page.enable');
  await p.send('Runtime.enable');
  await p.send('Page.navigate', { url: `${B}/` });
  const soon = soonIn(p);
  await soon(`document.readyState === 'complete'`, 'the dashboard page');
  // the dashboard frames the artifact as a viewer would: a real framed load, sec-fetch-dest: iframe
  await p.ev(`new Promise((resolve) => { window.__heard = []; const f = document.createElement('iframe'); f.id = 'art-frame'; f.style.cssText = 'position:fixed;left:0;top:0;width:800px;height:600px;border:0;z-index:99999'; addEventListener('message', (e) => { if (e.source === f.contentWindow) window.__heard.push({ data: e.data, origin: e.origin }); }); f.onload = () => resolve(true); f.src = '/artifact/main/inline-mock/'; document.body.appendChild(f); })`);
  const ask = (m) => p.ev(`(document.getElementById('art-frame').contentWindow.postMessage(${JSON.stringify(m)}, '*'), true)`);
  await ask({ ask: 'own' });
  await ask({ lens: 1, type: 'hello' });
  await ask({ lens: 1, type: 'hit', id: 'h1', x: 30, y: 30 });
  // the page's own address in its text, as a share link shows it on a box: pointed at, the token is cut
  await ask({ lens: 1, type: 'hit', id: 'h2', x: 30, y: 90 });
  // the last reply asked for is in, then a while longer, so anything unasked would have come too
  await soon(`window.__heard.some((h) => h.data && h.data.id === 'h2')`, 'its own script and the lens, answering');
  await new Promise((r) => setTimeout(r, 1500));
  const heard = await p.ev('window.__heard');
  const own = heard.filter((h) => h.data && h.data.own === 1);
  const lens = heard.filter((h) => h.data && h.data.lens === 1);
  assert.deepEqual(own.map((h) => h.data), [{ own: 1, ran: 'yes', blocked: [] }], 'its own inline scripts ran, and the policy blocked nothing on the page');
  assert.deepEqual(lens.map((h) => h.data.type), ['ready', 'hit-reply', 'hit-reply'], 'the lens answered, and said nothing unasked');
  assert.deepEqual(lens[0].data, { lens: 1, type: 'ready', path: '/artifact/main/inline-mock/', title: 'Retitled by its own script', viewport: { w: 800, h: 600 } }, 'the page as its own script left it: only what the page says of itself');
  assert.equal(lens[1].data.anchor.selector, '#art');
  assert.equal(lens[1].data.anchor.text, 'the mock');
  assert.deepEqual([lens[2].data.anchor.selector, lens[2].data.anchor.text], ['#share', 'http://box.example/artifact/main/inline-mock/']);
  assert.ok(lens.every((h) => !JSON.stringify(h.data).includes('/c/')), 'no capability in anything the lens said');
  assert.ok(heard.every((h) => h.origin === 'null'), 'from the artifact\'s opaque origin: the sandbox holds');
});

// The dashboard framed by a page of its own origin (a preview's app navigating its lens frame, or
// an artifact's page its own, to the dashboard's address) draws nothing and runs nothing.
test('the dashboard inside a frame of its own origin draws one line and runs nothing', { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket', timeout: 120000 }, async (t) => {
  const later = cleanup(t);
  const F = threadsFixture('framed-dash');
  later(() => F.done());
  const { dash, port } = await dashboardOnFreePort(F.old, F.env({}));
  const B = `http://127.0.0.1:${port}`;
  later(() => dash.stop());
  const chrome = await openChrome();
  later(() => chrome.close());
  const p = await chrome.newPage();
  later(() => p.close());
  await p.send('Page.enable');
  await p.send('Runtime.enable');
  await p.send('Page.addScriptToEvaluateOnNewDocument', { source: COUNT_FETCH });
  const soon = soonIn(p);
  await p.send('Page.navigate', { url: `${B}/` });
  await soon(`document.readyState === 'complete' && typeof DATA !== 'undefined' && !!document.querySelector('.app')`, 'the dashboard itself');
  for (const route of ['/', '/#inbox', '/view/artifact/x']) {
    const seen = await p.ev(`new Promise((resolve) => { const f = document.createElement('iframe'); f.id = 'probe'; setTimeout(() => { const w = f.contentWindow, d = f.contentDocument; resolve({ framed: !!w.frameElement, text: d.body.textContent.trim(), app: !!d.querySelector('.app, #artifact-view'), booted: typeof w.DATA !== 'undefined' || typeof w.TS !== 'undefined', asked: w.__asked ?? null }); f.remove(); }, 2500); f.src = ${JSON.stringify(route)}; document.body.append(f); })`);
    assert.deepEqual(seen, { framed: true, text: 'Open the dashboard in its own tab', app: false, booted: false, asked: [] }, `framed at ${route}`);
  }
  // the page itself, not framed, still runs
  assert.equal(await p.ev(`!!document.querySelector('.app') && typeof DATA !== 'undefined'`), true);
});

test('the viewer: one artifact on a stage the size of the tab, the threads and hello polled, never /api/data', { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket', timeout: 180000 }, async (t) => {
  const later = cleanup(t);
  const F = threadsFixture('viewer-page');
  later(() => F.done());
  const T = landArtifact(F, 'viewer-mock', VIEWER_MOCK);
  let B = null; // the dashboard's address, once it listens
  // A page of another origin to frame the viewer from, as the hub and the owner's wrapper do: the
  // dashboard's frame-ancestors name the hub's address, so a small server stands in as the hub.
  const hubPort = await freePort();
  const hub = http.createServer((q, r) => {
    const src = new URL(q.url, 'http://x').searchParams.get('src');
    if (!q.url.startsWith('/frame') || !src) { r.writeHead(404); return r.end(); }
    r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    r.end(`<!doctype html><title>parent</title><body><iframe id="v" style="width:900px;height:600px" src="${B}${src.replace(/"/g, '&quot;')}"></iframe>`);
  });
  await new Promise((r) => hub.listen(hubPort, '127.0.0.1', r));
  later(() => new Promise((r) => { hub.closeAllConnections?.(); hub.close(r); }));
  const { dash, port } = await dashboardOnFreePort(F.old, F.env({ DEVTEAM_HUB_PORT: String(hubPort) }));
  B = `http://127.0.0.1:${port}`;
  later(() => dash.stop());
  const chrome = await openChrome();
  later(() => chrome.close());
  const p = await chrome.newPage();
  later(() => p.close());
  await p.send('Page.enable');
  await p.send('Runtime.enable');
  await p.send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 800, deviceScaleFactor: 1, mobile: false });
  await p.send('Page.addScriptToEvaluateOnNewDocument', { source: COUNT_FETCH });
  const soon = soonIn(p);
  // A navigation, done: the last page gone (it is marked first, so a page at the same URL can't stand
  // in for the new one), the tab at that URL and loaded, and under /view/ the viewer booted.
  const go = async (url) => {
    await p.ev('window.__left = true').catch(() => {});
    await p.send('Page.navigate', { url });
    await soon(`!window.__left && location.href === ${JSON.stringify(url)} && document.readyState === 'complete'`, `the tab at ${url}`);
    if (new URL(url).pathname.startsWith('/view/')) await soon(`document.documentElement.classList.contains('viewer') && !!document.getElementById('av-title') && typeof TS === 'object'`, `the viewer at ${url}`);
  };
  // the viewer's own code, from its start to the line that runs it, without its comments
  const html = fs.readFileSync(path.join(kit, 'dashboard/index.html'), 'utf8');
  const boot = html.slice(html.indexOf('async function viewerBoot()'), html.indexOf('if (VIEWER) viewerBoot();')).replace(/^\s*\/\/.*$/gm, '');
  await t.test('landed: its title and the project in the bar, the page in the frame, nothing of the dashboard', async () => {
    await go(`${B}/view/artifact/viewer-mock`);
    await soon(`document.getElementById('av-title').textContent === 'Viewer mock' && document.getElementById('av-project').textContent === 'viewer-page'`, 'the bar');
    assert.equal(await p.ev(`document.getElementById('av-frame').getAttribute('src')`), '/artifact/main/viewer-mock/');
    assert.equal(await p.ev(`document.documentElement.classList.contains('viewer') && getComputedStyle(document.querySelector('.app')).display`), 'none');
    // the whole tab below a --bar-h band, where the Inbox button floats at the top right (kit-89 spec §2.8)
    assert.equal(await p.ev(`(() => { const r = document.getElementById('artifact-view').getBoundingClientRect(); return r.left === 0 && r.top === 49 && r.width === innerWidth && r.height === innerHeight - 49; })()`), true, 'the whole tab below the band');
    await soon(`(() => { const m = document.getElementById('tt-peek'), c = getComputedStyle(m), r = m.getBoundingClientRect(); return c.display !== 'none' && c.visibility === 'visible' && c.opacity === '1' && r.bottom <= 49 && Math.abs(innerWidth - r.right - 16) <= 1; })()`, '#tt-peek shown at the top right');
    assert.equal(await p.ev(`[TS.kind, TS.slug, TS.at, TS.fp === TS.mainFp, /^[0-9a-f]{64}$/.test(TS.fp)].join()`), 'artifact,viewer-mock,main,true,true');
    assert.equal(await p.ev(`!document.getElementById('tl-pill') && !!document.getElementById('threads')`), true, 'no dock; the Threads panel');
  });

  await t.test('it polls the threads and hello, and never /api/data', async () => {
    await soon(`window.__asked.filter((u) => u === '/api/threads').length >= 2`, 'two reads of the threads, 5 s apart');
    const asked = await p.ev('window.__asked');
    assert.ok(asked.includes('/api/hello'), asked.join(' '));
    assert.deepEqual(asked.filter((u) => !/^\/api\/(threads|hello|view\?)/.test(u)), [], 'nothing else');
    // the dashboard's own routing and drawing never run: no data, nothing routed, <main> as served
    assert.deepEqual(await p.ev('[DATA, ROUTED]'), [null, false]);
    assert.doesNotMatch(boot, /\b(route|render|load|loadNow|loadSchemaDocs)\(/, 'viewerBoot starts none of the dashboard');
  });

  await t.test('the published version by its tree; a tree the repository lacks shows main, and says so', async () => {
    await go(`${B}/view/artifact/viewer-mock?at=tree:${T}`);
    await soon(`document.getElementById('av-frame').getAttribute('src') === '/artifact/tree/${T}/viewer-mock/'`, 'the tree');
    assert.deepEqual(await p.ev(`[document.getElementById('av-where').textContent, document.getElementById('av-note').hidden, TS.at]`), ['the published version', true, `tree:${T}`]);
    await go(`${B}/view/artifact/viewer-mock?at=tree:${'0'.repeat(40)}`);
    await soon(`document.getElementById('av-frame').getAttribute('src') === '/artifact/main/viewer-mock/'`, 'main instead');
    assert.deepEqual(await p.ev(`[document.getElementById('av-note').hidden, document.getElementById('av-note').textContent, TS.at]`), [false, 'Not the published version: this is the one on main', 'main']);
  });

  await t.test("the wrapper's grant stays in the viewer's own URL, and never reaches the artifact's frame", async () => {
    const w = 'w=1767225600000.abcdefghijklmnopqrstuv';
    await go(`${B}/view/artifact/viewer-mock?at=tree:${T}&${w}`);
    await soon(`document.getElementById('av-frame').getAttribute('src') === '/artifact/tree/${T}/viewer-mock/'`, 'the tree, with no query passed on');
    const th = F.owner(['thread', 'new', 'About the mock', '--subject', JSON.stringify({ kind: 'artifact', slug: 'viewer-mock', at: `tree:${T}`, point: { x: 5, y: 5 } })]).split('\n')[0];
    await p.ev(`location.hash = '#talk/${th}'`);
    await soon(`!document.getElementById('tl-card').hidden`, 'its card');
    await p.ev('tlClose()');
    assert.equal(await p.ev('location.search'), `?at=tree:${T}&${w}`, 'opening and closing a card keeps it');
    // the fallback to main is shown in place: the URL, grant and all, stays as the wrapper gave it
    await go(`${B}/view/artifact/viewer-mock?at=tree:${'0'.repeat(40)}&${w}`);
    await soon(`document.getElementById('av-frame').getAttribute('src') === '/artifact/main/viewer-mock/'`, 'main instead');
    assert.equal(await p.ev('location.pathname + location.search'), `/view/artifact/viewer-mock?at=tree:${'0'.repeat(40)}&${w}`);
    // nothing in viewer mode moves the page to another URL
    assert.doesNotMatch(boot, /location\.(href|search|assign|replace|reload)\s*[=(]|history\./, 'viewerBoot never navigates');
  });

  await t.test('the frame is asked only what it is, and nothing needs an opener', async () => {
    // the stage's lens says hello on each load and keeps the page its lens names; with no pointer
    // over it, no question is minted and nothing else is kept from it
    await soon('TS.ready', 'the lens to say ready');
    assert.deepEqual(await p.ev('[TS.path, TS.minted.size, TS.rects.size, TS.keyOf.size, TS.last, TS.hit]'), ['index.html', 0, 0, 0, null, null]);
    assert.doesNotMatch(boot, /postMessage|contentWindow|addEventListener\('message'/, "the viewer's own start talks to no frame: the stage's lens does");
    assert.doesNotMatch(boot, /\bopener\b/, 'nothing reads or sets an opener');
    for (const w of boot.match(/window\.open\([^)]*\)/g) ?? []) assert.match(w, /'noopener,noreferrer'/, w);
    assert.match(html, /<a class="av-btn" id="av-tab" target="_blank" rel="noopener noreferrer"/);
    // a link into the dashboard from a viewer opens a tab of its own, with no opener
    const opened = await p.ev(`(() => { const got = []; const o = window.open; window.open = (...a) => { got.push(a); return null; }; const a = document.createElement('a'); a.href = '#library'; document.body.append(a); a.click(); a.remove(); window.open = o; return got; })()`);
    assert.deepEqual(opened, [['/#library', '_blank', 'noopener,noreferrer']]);
    assert.equal(await p.ev('location.hash'), '', 'and this tab stays where it is');
  });

  await t.test('a #talk/ link opens its card in a viewer tab, on load and by a hash change', async () => {
    const th = F.owner(['thread', 'new', 'On the viewer']).split('\n')[0];
    await go(`${B}/view/artifact/viewer-mock#talk/${th}`);
    await soon(`!document.getElementById('tl-card').hidden && TL.open === '${th}'`, 'its card, on load');
    await p.ev('tlClose()');
    assert.equal(await p.ev('location.pathname + location.search + location.hash'), '/view/artifact/viewer-mock', 'closing it drops the hash only');
    await p.ev(`location.hash = '#talk/${th}'`);
    await soon(`!document.getElementById('tl-card').hidden`, 'its card, by a hash change');
    await p.ev('tlClose()');
    assert.deepEqual(await p.ev('[DATA, ROUTED]'), [null, false], 'a hash change routes nothing of the dashboard');
  });

  await t.test("Send and Resolve in a viewer tab read no /api/data, and the tab's title stays the viewer's", async () => {
    const th = F.owner(['thread', 'new', 'Said from the viewer']).split('\n')[0];
    await go(`${B}/view/artifact/viewer-mock?at=main#talk/${th}`);
    await soon(`!document.getElementById('tl-card').hidden && TL.open === '${th}' && document.title === 'Viewer mock · devteam'`, 'its card, and the title');
    await p.ev(`(() => { const ta = document.getElementById('tl-c-text'); ta.value = 'one more thing'; ta.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('[data-tl-send]').click(); return true; })()`);
    await p.ev('Promise.all([...PRESSES.values()]).then(() => true)');
    await until(() => JSON.parse(F.owner(['thread', 'show', th, '--json'])).turns.some((u) => u.text === 'one more thing'), 'sent');
    assert.equal(await p.ev(`tlAct('thread-resolve', { id: '${th}' })`), true, 'resolved');
    assert.equal(JSON.parse(F.owner(['thread', 'show', th, '--json'])).status, 'resolved');
    // a read begun would have landed by now
    await new Promise((r) => setTimeout(r, 1000));
    assert.deepEqual(await p.ev(`window.__asked.filter((u) => u === '/api/data')`), [], 'no read of the dashboard');
    assert.deepEqual(await p.ev('[DATA, document.title]'), [null, 'Viewer mock · devteam']);
  });

  // the viewer framed from a page of another origin (the hub's address), read by its own script world
  const soonV = soonIn({ ev: (e) => p.evIn(B, e) });
  await t.test('framed without the keyboard, the viewer says to click it first; with it, nothing', async () => {
    await go(`http://127.0.0.1:${hubPort}/frame?src=${encodeURIComponent('/view/artifact/viewer-mock')}`);
    await soonV(`document.getElementById('av-title')?.textContent === 'Viewer mock'`, 'the framed viewer');
    // a real click, and what it should do: a headless tab can be left without the window's focus, so
    // a click that didn't move the keyboard is tried once more with the tab brought to the front
    const clickFor = async (x, y, expr, what) => {
      await p.clickAt(x, y);
      if (await soonIn({ ev: (e) => p.evIn(B, e) }, 5000)(expr, what).then(() => true, () => false)) return;
      await p.send('Page.bringToFront');
      await p.clickAt(x, y);
      await soonV(expr, what);
    };
    await p.ev('document.body.focus(); window.focus(); true');
    await soonV(`!document.getElementById('av-hint').hidden`, 'the hint, the top page having the keyboard');
    assert.equal(await p.evIn(B, `document.getElementById('av-hint').textContent`), 'Click the page, then hold Shift to point at something');
    // a real click on the framed viewer's bar, as the hint says
    const bar = await p.ev(`(() => { const r = document.getElementById('v').getBoundingClientRect(); return { x: r.left + 450, y: r.top + 20 }; })()`);
    await clickFor(bar.x, bar.y, `document.getElementById('av-hint').hidden`, 'gone once the viewer has it');
    // a click on the top page, outside the viewer, takes the keyboard back: the hint again
    await clickFor(1100, 700, `!document.getElementById('av-hint').hidden`, 'the hint, the keyboard gone');
    // a click on the artifact itself, in the viewer's own frame, gives it to the viewer's page
    const v = await p.ev(`(() => { const r = document.getElementById('v').getBoundingClientRect(); return { x: r.left, y: r.top }; })()`);
    const f = await p.evIn(B, `(() => { const r = document.getElementById('av-frame').getBoundingClientRect(); return { x: r.left, y: r.top }; })()`);
    await clickFor(v.x + f.x + 200, v.y + f.y + 200, `document.activeElement === document.getElementById('av-frame')`, 'the artifact has the keyboard');
    await soonV(`document.getElementById('av-hint').hidden`, 'gone once the artifact has it');
  });

  await t.test("framed, as the owner wrapper frames it, a published tree this checkout lacks isn't swapped for main: the gateway grants only that tree", async () => {
    const gone = '0'.repeat(40);
    await go(`http://127.0.0.1:${hubPort}/frame?src=${encodeURIComponent(`/view/artifact/viewer-mock?at=tree:${gone}`)}`);
    await soonV(`!document.getElementById('av-note').hidden && !!document.getElementById('av-frame').getAttribute('src')`, 'the framed viewer, its note');
    assert.deepEqual(await p.evIn(B, `[document.getElementById('av-note').textContent, document.getElementById('av-frame').getAttribute('src'), TS.at]`), ["The published version isn't in this checkout; open it from the Library.", `/artifact/tree/${gone}/viewer-mock/`, `tree:${gone}`]);
  });

  await t.test("an artifact /api/view can't read says so, and shows the version asked for: only nothing there falls back to main", async () => {
    // the viewer's /api/view answered with a failure: a 500, then no answer at all
    for (const [fault, what] of [['new Response(\'{}\', { status: 500 })', 'a 500'], ['Promise.reject(new TypeError(\'Failed to fetch\'))', 'a network error']]) {
      const { identifier } = await p.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { const f = window.fetch; window.fetch = (u, o) => (String(u).startsWith('/api/view') ? ${fault} : f(u, o)); })();` });
      await go(`${B}/view/artifact/viewer-mock?at=tree:${T}`);
      await soon(`document.getElementById('av-note').textContent === 'This artifact could not be read'`, `the note, for ${what}`);
      assert.deepEqual(await p.ev(`[document.getElementById('av-note').hidden, document.getElementById('av-frame').getAttribute('src'), TS.at]`), [false, `/artifact/tree/${T}/viewer-mock/`, `tree:${T}`], `${what}: the version asked for, not main`);
      await p.send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
    }
    // an artifact not there at all, even on main
    await go(`${B}/view/artifact/no-such-mock`);
    await soon(`document.getElementById('av-note').textContent === 'This artifact is not here'`, 'the note, for nothing there');
  });

  await t.test('Escape leaves it where it is: a viewer has nothing to go back to', async () => {
    await go(`${B}/view/artifact/viewer-mock`);
    await soon(`document.getElementById('av-title').textContent === 'Viewer mock'`, 'the viewer');
    // a listener added after the page's own runs after them: once it has seen the key, so have they
    await p.ev(`(() => { window.__esc = false; document.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.__esc = true; }); return true; })()`);
    await p.key('Escape');
    await soon('window.__esc', 'the key, handled');
    // and a frame later, nothing it might have queued has moved the page either
    await p.ev('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))');
    assert.deepEqual(await p.ev(`[document.getElementById('artifact-view').hidden, location.pathname, location.hash, window.__esc]`), [false, '/view/artifact/viewer-mock', '', true]);
  });
});
