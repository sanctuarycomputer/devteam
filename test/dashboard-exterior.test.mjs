// kit-137, then kit-866: self.md and exterior.md read-only beside the strategy, as documents. Real headless Chrome
// over a real bare-project dashboard whose main holds the self@2 and exterior@2 fixtures (test/fixtures/world2/) at
// the project's paths and the version 1 fixtures (test/fixtures/world/) in v1/; the page's fetch is wrapped so
// /api/data carries dashboard-data's old self and exterior keys (test/fixtures/world/dashboard-data.json), null
// ones, or none, and /api/governance lists the Project section (Strategy, Self, Exterior). Each Self and Exterior
// peek is the read-only file peek the Strategy row opens: the Markdown rendered, whatever dashboard-data says.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PORTS, bareProject, dashboardOnFreePort, dataPatchInit, write } from './lib/kit.mjs';
import { canDrive, cleanup, openChrome } from './lib/chrome.mjs';

const fixture = (dir, f) => fs.readFileSync(new URL(`./fixtures/${dir}/${f}`, import.meta.url), 'utf8');
const DATA = JSON.parse(fixture('world', 'dashboard-data.json'));
const PROJ = 'docs/devteam/project';
const SELF = `${PROJ}/self.md`, EXT = `${PROJ}/exterior.md`, STRAT = `${PROJ}/strategy.md`;
const V1SELF = 'v1/self.md', V1EXT = 'v1/exterior.md';
// the self@2 and exterior@2 fixtures, with links of each kind the page must judge: an .md outside self.md's folder
// and one inside it (parts and references, as test/fixtures/world2/check.mjs's parts() resolves them), an anchor,
// a reference and a folder in the Exterior
const SELF2 = `${fixture('world2', 'self.md')}\nIts notes: [the readme](../README.md), [a plan](notes/plan.md), [the strategy again](../project/strategy.md) and [its values](#values).\n`;
const EXT2 = `${fixture('world2', 'exterior.md')}\nIt is drawn against [the Self](self.md), beside [the docs](../docs/).\n`;
const SELF1 = fixture('world', 'self.md'), EXT1 = fixture('world', 'exterior.md');
const row = (p, title, at) => ({ group: 'project', path: p, title, last_change: at, differs: null, written: true, state: null });
const GOV = {
  files: [
    { group: 'governance', path: 'docs/devteam/governance/constitution.md', title: 'Constitution', last_change: '2026-11-01T00:00:00Z', differs: false, written: true, state: null },
    row(STRAT, 'Strategy', '2026-11-01T00:00:00Z'),
    row(SELF, 'Self', '2026-11-02T00:00:00Z'),
    row(EXT, 'Exterior', '2026-11-03T00:00:00Z'),
  ],
};
// the listing with the Self and the Exterior at other paths (the version 1 files, or files main doesn't hold)
const govAt = (self, ext) => ({ files: GOV.files.map((f) => (f.path === SELF ? { ...f, path: self } : f.path === EXT ? { ...f, path: ext } : f)) });
// dashboard-data's old keys three ways: as kit-139 and kit-135 made the server carry them, null, and gone (kit-868)
const VARIANTS = [
  ['old keys', { self: DATA.self, exterior: DATA.exterior }, []],
  ['null keys', { self: null, exterior: null }, []],
  ['no keys', {}, ['self', 'exterior']],
];
// the page's script: /api/data patched with window.__fx (dataPatchInit) and each key of drop taken out of it,
// /api/governance answered with gov, and /api/file answered 500 for a path in fail
const initFor = (patch, { drop = [], gov = GOV, fail = [] } = {}) => `${dataPatchInit(patch)}
(() => {
  window.__gov = ${JSON.stringify(gov)};
  // a dialog would stop the page under the test's driver: one that opens is an error the test reads
  window.alert = (m) => window.__errors.push('alert: ' + m);
  // each page starts in Rendered, whatever a subtest before it left chosen
  try { localStorage.setItem('devteam.mdview', 'rendered'); } catch {}
  const drop = ${JSON.stringify(drop)}, fail = ${JSON.stringify(fail)};
  const f = window.fetch;
  window.fetch = async (u, o) => {
    const at = new URL(String(u && u.url ? u.url : u), location.href);
    if (at.origin === location.origin && at.pathname === '/api/governance') return new Response(JSON.stringify(window.__gov), { status: 200, headers: { 'content-type': 'application/json' } });
    if (at.origin === location.origin && at.pathname === '/api/file' && fail.includes(at.searchParams.get('path'))) return new Response('the read broke', { status: 500 });
    const r = await f(u, o);
    if (!drop.length || at.origin !== location.origin || at.pathname !== '/api/data' || !r.ok) return r;
    const d = await r.json();
    for (const k of drop) delete d[k];
    return new Response(JSON.stringify(d), { status: r.status, statusText: r.statusText, headers: r.headers });
  };
})();`;

const soonIn = (p, ms = 15000) => async (expr, what) => {
  const end = Date.now() + ms;
  for (;;) {
    let v, err = null;
    try { v = await p.ev(expr); } catch (e) { err = e; }
    if (v) return v;
    if (Date.now() > end) assert.fail(`timed out: ${what}${err ? `; last: ${err.message}` : ''}`);
    await new Promise((r) => setTimeout(r, 50));
  }
};

test('self.md and exterior.md beside the strategy, as documents', { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket', timeout: 300000 }, async (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-exterior-'));
  const later = cleanup(t);
  later(() => fs.rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const env = { ...process.env, HOME: base, DEVTEAM_HUB_PORT: String(PORTS + 97), DEVTEAM_PORT_BASE: String(PORTS + 98), CLAUDE_CONFIG_DIR: path.join(base, 'claude'), CODEX_HOME: path.join(base, 'codex') };
  for (const k of ['DEVTEAM_ROLE', 'DEVTEAM_TICKET', 'DEVTEAM_FEATURE', 'DEVTEAM_RUN', 'DEVTEAM_SUPERVISOR', 'DEVTEAM_HOME', 'TMUX', 'TMUX_PANE']) delete env[k];
  const root = bareProject(base, 'world');
  // main holds the strategy, the version 2 Self and Exterior at the project's paths, the version 1 ones in v1/,
  // and a copy of the version 1 Exterior in notes/, which is not the project's
  write(path.join(root, STRAT), fixture('world2', 'strategy.md'));
  write(path.join(root, SELF), SELF2);
  write(path.join(root, EXT), EXT2);
  write(path.join(root, V1SELF), SELF1);
  write(path.join(root, V1EXT), EXT1);
  write(path.join(root, 'notes/exterior.md'), EXT1);
  const git = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...a], { cwd: root });
  git('add', '-A');
  git('commit', '-qm', 'the project');
  const { dash, port } = await dashboardOnFreePort(root, env);
  later(() => dash.stop());
  const chrome = await openChrome();
  later(() => chrome.close());
  const p = await chrome.newPage();
  later(() => p.close());
  await p.send('Page.enable');
  await p.send('Runtime.enable');
  await p.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  const soon = soonIn(p);

  let script = null;
  const load = async (patch, hash = '#governance', opts = {}) => {
    if (script) await p.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: script });
    script = (await p.send('Page.addScriptToEvaluateOnNewDocument', { source: initFor(patch, opts) })).identifier;
    await p.send('Page.navigate', { url: 'about:blank' });
    await soon("location.href === 'about:blank'", 'a blank page');
    await p.send('Page.navigate', { url: `http://127.0.0.1:${port}/${hash}` });
    // and loaded (kit-784): until the load event, Chrome makes a script's hash change with no user gesture (every
    // p.ev here) replace the entry rather than add one, so a Back or a close after it would land off the page
    await soon("document.readyState === 'complete' && typeof DATA !== 'undefined' && !!DATA && !document.querySelector('main.waiting')", 'the dashboard drawn');
    // a listing at other paths is read before a peek relies on it
    if (opts.gov) await soon(`GOV.files && GOV.files.some((f) => f.path === ${JSON.stringify(opts.gov.files.find((f) => f.title === 'Self').path)})`, 'the listing read');
  };
  const drawerOpen = "!document.getElementById('drawer').hidden && document.body.classList.contains('peek-open')";
  // the peek of a file, opened by its link, drawn (no loading marker, its rendered Markdown or an error there)
  const peekReady = (file) => `${drawerOpen} && DRAWER.kind === 'file' && DRAWER.id === ${JSON.stringify(file)} && !document.querySelector('#drawer-body .loading') && !!document.querySelector('#drawer-body .md, #drawer-body .err')`;
  const openPeek = async (file, title, extra = '') => {
    await p.ev(`location.hash = ${JSON.stringify(`#file?path=${encodeURIComponent(file)}&title=${encodeURIComponent(title)}${extra}`)}; void 0`);
    await soon(peekReady(file), `the ${title} peek`);
  };
  const closePeek = async () => {
    if (!(await p.ev(drawerOpen))) return;
    await p.key('Escape');
    await soon("document.getElementById('drawer').hidden", 'the peek closed');
  };
  const fold = "replace(/\\s+/g, ' ').trim()";
  const md = (expr) => p.ev(`(() => { const m = document.querySelector('#drawer-body .md'); return m ? (${expr}) : null; })()`);
  const howItChanges = () => p.ev(`(() => { const dts = [...document.querySelectorAll('#drawer-body section.attrs dl.props dt')]; const dt = dts.find((d) => d.textContent.trim() === 'How it changes'); return dt?.nextElementSibling?.textContent.${fold} ?? null; })()`);
  const paras = () => md(`[...m.querySelectorAll('p')].map((x) => x.textContent.${fold})`);
  // what a version 2 document must render as: its title, its prose, no lists the dashboard drew, no not-drafted line
  const asDocument = () => md(`({ h1: [...m.querySelectorAll('h1')].map((h) => h.textContent.trim()), h3: [...m.querySelectorAll('h3')].map((h) => h.textContent.trim()), undrafted: /not drafted yet/.test(m.textContent) })`);
  // the rendered links: [words, href]
  const links = () => md(`[...m.querySelectorAll('a')].map((a) => [a.textContent.${fold}, a.getAttribute('href')])`);

  // A1: the Project section's rows, Strategy beside Self and Exterior, each opening the file peek
  await t.test('A1 Self and Exterior beside Strategy open the file peek', async () => {
    await load(VARIANTS[0][1]);
    await soon("!!document.querySelector('#governance [data-tbl=\"gov:project\"] tbody tr')", 'the Project section');
    const rows = await p.ev("[...document.querySelectorAll('#governance [data-tbl=\"gov:project\"] tbody tr')].map((r) => r.cells[0].textContent.trim())");
    assert.deepEqual(rows, ['Strategy', 'Self', 'Exterior']);
    for (const [i, how, file] of [[0, 'click', STRAT], [1, 'click', SELF], [2, 'enter', EXT]]) {
      const ok = await p.ev(`(() => { const tr = document.querySelectorAll('#governance [data-tbl="gov:project"] tbody tr')[${i}]; tr.scrollIntoView({ block: 'center' }); tr.focus(); return document.activeElement === tr; })()`);
      assert.ok(ok, `row ${i} focusable`);
      if (how === 'click') {
        const at = await p.ev(`(() => { const r = document.querySelectorAll('#governance [data-tbl="gov:project"] tbody tr')[${i}].cells[2].getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
        await p.clickAt(at.x, at.y);
      } else await p.key('Enter');
      await soon(`${drawerOpen} && DRAWER.kind === 'file' && DRAWER.id === ${JSON.stringify(file)}`, `row ${i} opens ${file}`);
      await closePeek();
    }
  });

  // A2: read-only, and How it changes says what it says for the strategy
  await t.test('A2 read-only, and governed as the strategy', async () => {
    for (const [file, title] of [[STRAT, 'Strategy'], [SELF, 'Self'], [EXT, 'Exterior']]) {
      await openPeek(file, title);
      assert.equal(await p.ev("document.querySelectorAll('#drawer-body input, #drawer-body textarea, #drawer-body select, #drawer-body [contenteditable]').length"), 0, `${title}: nothing editable`);
      assert.equal(await howItChanges(), 'The supervisor drafts it from your thread; it lands with your yes', `${title}: how it changes`);
      await closePeek();
    }
  });

  // B1: a plain self.md and exterior.md render as any document, the same with dashboard-data's old keys, null ones or none
  await t.test('B1 plain documents, whatever dashboard-data says', async () => {
    const seen = {};
    for (const [name, patch, drop] of VARIANTS) {
      await load(patch, '#overview', { drop });
      for (const [file, title, prose] of [[SELF, 'Self', 'Quillmark is an app for long notes.'], [EXT, 'Exterior', 'The most important come first.']]) {
        await openPeek(file, title);
        assert.deepEqual(await asDocument(), { h1: [title], h3: title === 'Self' ? [] : ['Ledgerpad', 'Acme Storage', 'Open Notes Format'], undrafted: false }, `${name}, ${title}: a document, not lists`);
        assert.ok((await paras()).some((x) => x.startsWith(prose)), `${name}, ${title}: its prose`);
        const html = await md('m.innerHTML');
        (seen[title] ??= []).push(html);
        await closePeek();
      }
    }
    for (const [title, htmls] of Object.entries(seen)) assert.equal(new Set(htmls).size, 1, `${title}: the same render with old keys, null ones and none`);
  });

  // B2: a part link shows as its words and leads nowhere; a reference to a Markdown file beside it opens that file's
  // peek; a web link stays a link
  await t.test('B2 a part link is its words', async () => {
    await load({}, '#overview', { drop: ['self', 'exterior'] });
    await openPeek(SELF, 'Self');
    assert.ok((await paras()).some((x) => x.startsWith('Its parts are the app, the sync service and its plugin interface.')), 'the parts in words');
    // clicking a part's words goes nowhere: the peek stays open on the Self, on the dashboard's own page
    const at = await md(`(() => { const w = document.createTreeWalker(m, NodeFilter.SHOW_TEXT); let tn; while ((tn = w.nextNode()) && !tn.textContent.includes('the sync service')); tn.parentElement.scrollIntoView({ block: 'center' }); const r = document.createRange(); const i = tn.textContent.indexOf('the sync service'); r.setStart(tn, i); r.setEnd(tn, i + 4); const b = r.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, seen: b.width > 0 && b.top >= 0 && b.bottom <= innerHeight && b.left >= 0 && b.right <= innerWidth }; })()`);
    assert.ok(at.seen, 'the words to click are in view');
    await p.clickAt(at.x, at.y);
    await new Promise((r) => setTimeout(r, 500));
    assert.equal(await p.ev(`location.pathname === '/' && ${drawerOpen} && DRAWER.id === ${JSON.stringify(SELF)}`).catch(() => false), true, 'a part\'s words lead nowhere');
    const ls = await links();
    assert.deepEqual(ls.filter(([, h]) => !/^(https?:|#file\?)/.test(h ?? '')), [], 'no link to a page the dashboard lacks');
    assert.equal(await md("[...m.querySelectorAll('p code')].some((c) => c.textContent === 'plugin' && !c.closest('a'))"), true, 'a part link\'s code kept, not linked');
    assert.deepEqual(ls.find(([w]) => w === 'the format it follows'), ['the format it follows', 'https://acme.example/format'], 'a web link stays');
    // only an .md in self.md's own folder is a reference: one elsewhere is a part, and an anchor has no page here
    assert.deepEqual(ls.filter(([w]) => ['the readme', 'a plan', 'its values'].includes(w)), [], 'an .md elsewhere and an anchor: words');
    assert.ok((await paras()).some((x) => x.includes('the readme, a plan, the strategy again and its values.')), 'their words show');
    // the references to strategy.md, as written and by a path through its folder, open the strategy's peek at main
    for (const words of ['the strategy', 'the strategy again']) {
      const ref = ls.find(([w]) => w === words);
      assert.ok(ref && ref[1].startsWith('#file?'), `${words}: a peek link: ${ref}`);
      assert.equal(new URLSearchParams(ref[1].slice(6)).get('path'), STRAT, `${words}: resolved from self.md's folder`);
    }
    await p.ev("document.querySelector('#drawer-body .md a[href^=\"#file?\"]').click(); void 0");
    await soon(peekReady(STRAT), 'the strategy peek');
    await closePeek();
    // the Exterior's links keep the same rule: its web links stay, a reference opens its peek, a folder is words
    await openPeek(EXT, 'Exterior');
    const el = await links();
    assert.deepEqual(el.filter(([, h]) => !/^(https?:|#file\?)/.test(h ?? '')), [], 'Exterior: no link to a page the dashboard lacks');
    assert.deepEqual(el.find(([w]) => w === 'Its page'), ['Its page', 'https://ledgerpad.example/plans'], 'Exterior: a web link stays');
    assert.equal(new URLSearchParams((el.find(([w]) => w === 'the Self')?.[1] ?? '').slice(6)).get('path'), SELF, 'Exterior: a reference opens its peek');
    await closePeek();
  });

  // B3: a version 1 file's prose shows and its block doesn't, in Rendered; Raw shows the file as it is
  await t.test('B3 a version 1 file', async () => {
    for (const [name, patch, drop] of VARIANTS) {
      await load(patch, '#governance', { drop, gov: govAt(V1SELF, V1EXT) });
      for (const [file, title, prose, text, lang] of [[V1SELF, 'Self', 'Quillmark is a note app', SELF1, 'self'], [V1EXT, 'Exterior', 'It serves independent researchers', EXT1, 'exterior']]) {
        await p.ev(`(() => { try { localStorage.setItem('devteam.mdview', 'rendered'); } catch {} })()`);
        await openPeek(file, title);
        assert.ok((await paras()).some((x) => x.startsWith(prose)), `${name}, ${title}: its prose`);
        assert.equal(await md(`!m.querySelector('pre, code.language-${lang}') && !m.querySelector('h3') && !/\\{\\s*"${lang}"\\s*:\\s*1/.test(m.textContent) && !/not drafted yet/.test(m.textContent)`), true, `${name}, ${title}: no block, no lists`);
        await p.ev("document.querySelector('#drawer-body [data-mdview=\"raw\"]').click(); void 0");
        await soon("!document.querySelector('#drawer-body pre[data-md=\"raw\"]').hidden", 'Raw shown');
        assert.equal(await p.ev("document.querySelector('#drawer-body pre[data-md=\"raw\"]').textContent"), text, `${name}, ${title}: Raw is the file as it is`);
        await p.ev("document.querySelector('#drawer-body [data-mdview=\"rendered\"]').click(); void 0");
        await closePeek();
      }
    }
  });

  // B4: worldBlocks is gone from the page
  await t.test('B4 worldBlocks is gone', async () => {
    const html = fs.readFileSync(new URL('../docs/devteam/dashboard/index.html', import.meta.url), 'utf8');
    assert.equal(html.split('worldBlocks').length - 1, 0, 'worldBlocks named in index.html');
    assert.equal(await p.ev("typeof worldBlocks"), 'undefined', 'worldBlocks on the page');
  });

  // B5: a missing file says it is not drafted yet, whatever dashboard-data says; another failed read says its error
  await t.test('B5 a missing file is not drafted yet', async () => {
    const GONE_SELF = 'proj2/self.md', GONE_EXT = 'proj2/exterior.md';
    for (const [name, patch, drop] of VARIANTS) {
      await load(patch, '#governance', { drop, gov: govAt(GONE_SELF, GONE_EXT) });
      for (const [file, title, line] of [[GONE_SELF, 'Self', 'The Self is not drafted yet: main has no self.md.'], [GONE_EXT, 'Exterior', 'The Exterior is not drafted yet: main has no exterior.md.']]) {
        await openPeek(file, title);
        assert.equal(await md(`m.textContent.${fold}`), line, `${name}, ${title}: not drafted`);
        assert.equal(await p.ev("document.querySelectorAll('#drawer-body .err').length"), 0, `${name}, ${title}: no error`);
        await closePeek();
      }
    }
    // a read that fails for another reason is its error, not "not drafted"
    await load({ self: null, exterior: null }, '#overview', { fail: [SELF] });
    await openPeek(SELF, 'Self');
    assert.equal(await p.ev("[...document.querySelectorAll('#drawer-body .err')].map((e) => e.textContent.trim()).join('|')"), 'the read broke', 'another failure: its error');
    assert.equal(await p.ev("/not drafted yet/.test(document.getElementById('drawer-body').textContent)"), false, 'another failure: not said to be undrafted');
    await closePeek();
  });

  // B6: running text in the peek's viewer no wider than the kit's measure token (test/lib/measure.mjs's token('--measure');
  // ruling m-20261121-180022415-supervisor: the token, not a literal 560px)
  await t.test('B6 running text keeps to the measure', async () => {
    await load({}, '#overview', { drop: ['self', 'exterior'] });
    for (const [file, title] of [[SELF, 'Self'], [EXT, 'Exterior']]) {
      await openPeek(file, title);
      const r = await p.ev(`(() => {
        const m = document.querySelector('#drawer-body .viewer');
        const probe = document.createElement('div');
        probe.style.cssText = 'position:absolute;visibility:hidden;width:var(--measure)';
        document.body.append(probe);
        const ms = probe.getBoundingClientRect().width;
        probe.remove();
        const els = [...m.querySelectorAll('p, li, h2, h3')].filter((e) => !e.closest('[hidden]'));
        return { ms, n: els.length, wide: els.filter((e) => e.getBoundingClientRect().width > ms + 1).map((e) => Math.round(e.getBoundingClientRect().width) + 'px ' + e.textContent.slice(0, 30)) };
      })()`);
      assert.ok(r.ms > 0, `the measure resolves: ${r.ms}`);
      assert.ok(r.n > 0, `${title}: text drawn`);
      assert.deepEqual(r.wide, [], `${title}: wider than the measure (${r.ms}px)`);
      await closePeek();
    }
  });

  // B7: only main's project files: a ref's text and another exterior.md stay as written, block and links too
  await t.test('B7 only main, only the project', async () => {
    await load({}, '#overview', { drop: ['self', 'exterior'] });
    await openPeek(SELF, 'Self', '&ref=main');
    assert.ok((await links()).some(([w, h]) => w === 'the app' && h === '../app/'), 'a ref peek: its links as written');
    await closePeek();
    await openPeek('notes/exterior.md', 'exterior.md');
    assert.equal(await md("!!m.querySelector('pre > code.language-exterior')"), true, 'another exterior.md: its block as code');
    await closePeek();
    await openPeek(V1EXT, 'Exterior');
    assert.equal(await md("!!m.querySelector('pre > code.language-exterior')"), true, 'v1/exterior.md unlisted: its block as code');
    await closePeek();
    assert.deepEqual(await p.ev('window.__errors'), []);
  });
});
