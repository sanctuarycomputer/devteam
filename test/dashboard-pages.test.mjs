// The dashboard's frame (kit-87, spec §1-3 and §6): a grouped side nav, a page bar with the Inbox
// button, and one page shown at a time. Headless Chrome against a real dashboard on a bare project.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PORTS, bareProject, dashboardOnFreePort, until } from './lib/kit.mjs';
import { canDrive, cleanup, openChrome } from './lib/chrome.mjs';

const NAV = [['Project', ['Overview', 'Inbox', 'Goals', 'Progress', 'Board', 'Library']], ['Autonomy', ['Trust', 'Sensors', 'Health', 'Retros', 'Self Improvement']]];

test('pages and nav', { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket', timeout: 600000 }, async (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-dash-pages-'));
  const later = cleanup(t);
  later(() => fs.rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const env = { ...process.env, HOME: base, DEVTEAM_HUB_PORT: String(PORTS + 2), DEVTEAM_PORT_BASE: String(PORTS + 3), CLAUDE_CONFIG_DIR: path.join(base, 'claude'), CODEX_HOME: path.join(base, 'codex') };
  for (const k of Object.keys(env)) if (k.startsWith('DEVTEAM_') && !['DEVTEAM_HUB_PORT', 'DEVTEAM_PORT_BASE'].includes(k)) delete env[k];
  for (const k of ['TMUX', 'TMUX_PANE']) delete env[k];
  const root = bareProject(base, 'pages');
  const { dash, port } = await dashboardOnFreePort(root, env);
  later(() => dash.stop());
  const chrome = await openChrome();
  later(() => chrome.close());
  const p = await chrome.newPage();
  later(() => p.close());
  await p.send('Page.enable');
  await p.send('Runtime.enable');
  // no classic scrollbar: innerWidth is the window's right edge
  await p.send('Emulation.setScrollbarsHidden', { hidden: true });
  const size = (width, height) => p.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  const url = (hash) => `http://127.0.0.1:${port}/${hash}`;
  const load = async (hash) => {
    await p.send('Page.navigate', { url: 'about:blank' });
    await until(() => p.ev("location.href === 'about:blank'"), 'about:blank');
    await p.send('Page.navigate', { url: url(hash) });
    await until(() => p.ev("location.protocol === 'http:' && !!document.querySelector('main') && !document.querySelector('main.waiting')"), 'the dashboard drawn');
  };
  const shown = () => p.ev("[...document.querySelectorAll('main > section[data-page]')].filter((s) => getComputedStyle(s).display !== 'none').map((s) => s.dataset.page)");
  const onPage = (id) => until(async () => JSON.stringify(await shown()) === JSON.stringify([id]) && await p.ev(`location.hash === ${JSON.stringify(`#${id}`)}`), `page ${id} alone`);

  await size(1440, 900);
  await load('#overview');

  // the nav, by group
  const nav = await p.ev("[...document.querySelectorAll('.side nav.nav[data-group]')].map((n) => [n.previousElementSibling?.textContent.trim(), [...n.querySelectorAll('a')].map((a) => a.querySelector('.nl').textContent.trim())])");
  assert.deepEqual(nav, NAV);
  const links = await p.ev("[...document.querySelectorAll('.side nav.nav[data-group] a')].map((a) => ({ href: a.getAttribute('href'), label: a.querySelector('.nl').textContent.trim() }))");

  // each link: only its page, the title, aria-current
  for (const { href, label } of links) {
    await p.click(`.side nav.nav a[href="${href}"]`);
    const id = href.slice(1);
    await onPage(id);
    assert.equal(await p.ev("document.querySelector('#page-title').textContent.trim()"), label, `${href}: the page bar's title`);
    assert.deepEqual(await p.ev("[...document.querySelectorAll('.side nav.nav a[aria-current=\"page\"]')].map((a) => a.getAttribute('href'))"), [href], `${href}: aria-current`);
  }
  // Back: the previous page
  const prev = links.at(-2).href.slice(1);
  await p.ev('history.back()');
  await onPage(prev);

  // changing page scrolls to the top
  await p.click('.side nav.nav a[href="#board"]');
  await onPage('board');
  // both pages taller than the window, so only showPage can bring Library to the top
  await p.ev("document.querySelector('#board').style.minHeight = '4000px'; document.querySelector('#library').style.minHeight = '4000px'");
  await p.ev('window.scrollTo(0, 1500)');
  await until(() => p.ev('scrollY > 0'), 'Board scrolled down');
  await p.click('.side nav.nav a[href="#library"]');
  await onPage('library');
  assert.equal(await p.ev('scrollY'), 0, 'Library opens at the top');
  await p.ev("document.querySelector('#board').style.minHeight = ''; document.querySelector('#library').style.minHeight = ''");

  // the Inbox button's count is the nav's
  assert.equal(await p.ev("document.querySelector('#inbox-btn-n').textContent"), await p.ev("document.querySelector('#n-questions').textContent"));

  // a cold load of an unknown head: Overview, in the address bar too
  await load('#nonsense');
  await until(() => p.ev("location.hash === '#overview'"), '#overview in the address bar');
  assert.deepEqual(await shown(), ['overview']);

  // the page bar and its Inbox button at two sizes, on every page
  const pages = [...links.map((l) => l.href.slice(1)), 'settings'];
  for (const [w, h] of [[1440, 900], [390, 844]]) {
    await size(w, h);
    for (const id of pages) {
      await p.ev(`location.hash = ${JSON.stringify(`#${id}`)}`);
      await onPage(id);
      await p.ev('window.scrollTo(0, 0)');
      const m = await p.ev(`(() => {
        const cs = getComputedStyle(document.documentElement);
        const bar = document.querySelector('.pagebar').getBoundingClientRect(), b = document.querySelector('#inbox-btn').getBoundingClientRect();
        return { pageMax: parseFloat(cs.getPropertyValue('--page-max')), headerPad: parseFloat(cs.getPropertyValue('--header-pad')), barW: bar.width, barTop: bar.top, barBottom: bar.bottom, right: innerWidth - b.right, bTop: b.top };
      })()`);
      const at = `#${id} at ${w}x${h}`;
      if (w === 1440) assert.ok(m.barW > m.pageMax, `${at}: the page bar (${m.barW}px) is wider than --page-max (${m.pageMax}px)`);
      assert.ok(Math.abs(m.right - m.headerPad) <= 0.5, `${at}: the Inbox button ends ${m.right}px from the window's right, not --header-pad ${m.headerPad}px`);
      assert.equal(m.barTop, 0, `${at}: the page bar starts at the window's top`);
      assert.ok(m.bTop >= m.barTop && m.bTop < m.barBottom, `${at}: the Inbox button's top (${m.bTop}) is inside the page bar (${m.barTop}-${m.barBottom})`);
    }
    await p.ev("location.hash = '#overview'");
    await onPage('overview');
    await p.click('#inbox-btn');
    await onPage('inbox');
  }
});
