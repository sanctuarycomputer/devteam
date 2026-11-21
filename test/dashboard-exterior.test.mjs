// kit-137: self.md and exterior.md read-only beside the strategy. Real headless Chrome over a real bare-project
// dashboard whose main holds the contract's fixture self.md and exterior.md (test/fixtures/world/); the page's
// fetch is wrapped so /api/data carries the contract's dashboard blocks (test/fixtures/world/dashboard-data.json,
// as kit-139 and kit-135 make the server carry them) and /api/governance lists the Project section as kit-139
// makes it (Strategy, Self, Exterior). Each Self and Exterior peek is the read-only file peek the Strategy row
// opens, its fenced block drawn as lists (worldBlocks), never raw JSON.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PORTS, bareProject, dashboardOnFreePort, dataPatchInit, write } from './lib/kit.mjs';
import { canDrive, cleanup, openChrome } from './lib/chrome.mjs';

const world = (f) => fs.readFileSync(new URL(`./fixtures/world/${f}`, import.meta.url), 'utf8');
const DATA = JSON.parse(world('dashboard-data.json'));
const PROJ = 'docs/devteam/project';
const SELF = `${PROJ}/self.md`, EXT = `${PROJ}/exterior.md`, STRAT = `${PROJ}/strategy.md`;
const GOV = {
  files: [
    { group: 'governance', path: 'docs/devteam/governance/constitution.md', title: 'Constitution', last_change: '2026-11-01T00:00:00Z', differs: false, written: true, state: null },
    { group: 'project', path: STRAT, title: 'Strategy', last_change: '2026-11-01T00:00:00Z', differs: null, written: true, state: null },
    { group: 'project', path: SELF, title: 'Self', last_change: '2026-11-02T00:00:00Z', differs: null, written: true, state: null },
    { group: 'project', path: EXT, title: 'Exterior', last_change: '2026-11-03T00:00:00Z', differs: null, written: true, state: null },
  ],
};
const XSS = '<img src=x onerror=alert(1)>';
const clone = (x) => JSON.parse(JSON.stringify(x));
// the page's script: /api/data patched with window.__fx (dataPatchInit) and each key of drop taken out of it (so a
// server that carries self and exterior, once kit-139 and kit-135 land, is still tested without them), and
// /api/governance answered with gov
const initFor = (patch, { drop = [], gov = GOV } = {}) => `${dataPatchInit(patch)}
(() => {
  window.__gov = ${JSON.stringify(gov)};
  // a dialog would stop the page under the test's driver: one that opens is an error the test reads
  window.alert = (m) => window.__errors.push('alert: ' + m);
  const drop = ${JSON.stringify(drop)};
  const f = window.fetch;
  window.fetch = async (u, o) => {
    const at = new URL(String(u && u.url ? u.url : u), location.href);
    if (at.origin === location.origin && at.pathname === '/api/governance') return new Response(JSON.stringify(window.__gov), { status: 200, headers: { 'content-type': 'application/json' } });
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

test('self.md and exterior.md beside the strategy', { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket', timeout: 300000 }, async (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-exterior-'));
  const later = cleanup(t);
  later(() => fs.rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const env = { ...process.env, HOME: base, DEVTEAM_HUB_PORT: String(PORTS + 97), DEVTEAM_PORT_BASE: String(PORTS + 98), CLAUDE_CONFIG_DIR: path.join(base, 'claude'), CODEX_HOME: path.join(base, 'codex') };
  for (const k of ['DEVTEAM_ROLE', 'DEVTEAM_TICKET', 'DEVTEAM_FEATURE', 'DEVTEAM_RUN', 'DEVTEAM_SUPERVISOR', 'DEVTEAM_HOME', 'TMUX', 'TMUX_PANE']) delete env[k];
  const root = bareProject(base, 'world');
  // main holds the fixture's strategy, Self and Exterior; and a copy of the Exterior elsewhere, which is not the project's
  write(path.join(root, STRAT), world('strategy.md'));
  write(path.join(root, SELF), world('self.md'));
  write(path.join(root, EXT), world('exterior.md'));
  write(path.join(root, 'notes/exterior.md'), world('exterior.md'));
  // a project whose folder is not docs/devteam/project: its exterior.md is the project's only by the governance listing
  write(path.join(root, 'proj/exterior.md'), world('exterior.md'));
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
    await soon("typeof DATA !== 'undefined' && !!DATA && !document.querySelector('main.waiting')", 'the dashboard drawn');
  };
  const drawerOpen = "!document.getElementById('drawer').hidden && document.body.classList.contains('peek-open')";
  // the peek of a file, opened by its link, drawn (no loading marker, its rendered Markdown there)
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
  // the world lists' headings and the items right under each: [[heading, [item text…]]…]
  const sections = () => md(`[...m.querySelectorAll('h3')].map((h) => { const n = h.nextElementSibling; return [h.textContent.${fold}, n && n.tagName === 'UL' ? [...n.children].map((li) => li.textContent.${fold}) : n ? [n.textContent.${fold}] : []]; })`);
  // the nested signal list of the entity named name
  const signalsOf = (name) => md(`(() => { const li = [...m.querySelectorAll('li')].find((x) => x.querySelector('b, strong')?.textContent.trim() === ${JSON.stringify(name)}); return li ? [...(li.querySelector('ul')?.children ?? [])].map((x) => x.textContent.${fold}) : null; })()`);
  const howItChanges = () => p.ev(`(() => { const dts = [...document.querySelectorAll('#drawer-body section.attrs dl.props dt')]; const dt = dts.find((d) => d.textContent.trim() === 'How it changes'); return dt?.nextElementSibling?.textContent.${fold} ?? null; })()`);
  const noRawJson = () => md(`!m.querySelector('code.language-self, code.language-exterior') && ![...m.querySelectorAll('pre, code')].some((c) => /"(self|exterior)"\\s*:\\s*1|\\{/.test(c.textContent))`);

  const paras = () => md(`[...m.querySelectorAll('p')].map((x) => x.textContent.${fold})`);
  const FULL = { self: DATA.self, exterior: DATA.exterior };

  // A1: the Project section's rows, Strategy beside Self and Exterior, each opening the file peek
  await t.test('A1 Self and Exterior beside Strategy open the file peek', async () => {
    await load(FULL);
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

  // A3: each file's prose, rendered
  await t.test('A3 the prose renders', async () => {
    await openPeek(SELF, 'Self');
    const ps = await paras();
    for (const start of ['Quillmark is a note app', 'Its parts are the app', 'It controls its code']) assert.ok(ps.some((x) => x.startsWith(start)), `Self prose: ${start}`);
    await closePeek();
    await openPeek(EXT, 'Exterior');
    assert.ok((await paras()).some((x) => x.startsWith('It serves independent researchers')), 'Exterior prose');
    await closePeek();
  });

  // A4: no raw JSON in the rendered view
  await t.test('A4 not raw JSON', async () => {
    for (const [file, title] of [[SELF, 'Self'], [EXT, 'Exterior']]) {
      await openPeek(file, title);
      assert.equal(await noRawJson(), true, `${title}: no raw JSON`);
      await closePeek();
    }
  });

  // A5: the Self's block as lists
  await t.test("A5 the Self's parts as lists", async () => {
    await openPeek(SELF, 'Self');
    const s = DATA.self;
    assert.deepEqual(await sections(), [
      ['What it is', [s.what]],
      ['What it makes', [s.makes]],
      ['Its parts', s.parts.map((x) => `${x.name}: ${x.what} ${x.code.join(' ')}`)],
      ['What it controls', s.controls],
      ['What it touches but does not control', s.not],
    ]);
    assert.deepEqual(await md("[...m.querySelectorAll('li code')].map((c) => c.textContent)"), s.parts.flatMap((x) => x.code));
    await closePeek();
  });

  // A6: the entities by relation, each with its kind and what matters
  await t.test('A6 the entities by relation', async () => {
    await openPeek(EXT, 'Exterior');
    const KIND = { organisation: 'an organisation', group: 'a group', work: 'a work' };
    const sec = await sections();
    assert.deepEqual(sec.map(([h]) => h), ['It serves', 'It depends on', 'Builds on it', 'Its alternatives', 'It works with', 'Governs it', 'It affects', 'Other: sponsors']);
    const byRel = ['serves', 'depends_on', 'builds_on_it', 'alternative', 'collaborates', 'governs', 'affects', 'other'];
    sec.forEach(([h, items], i) => {
      const want = DATA.exterior.entities.filter((e) => e.relation === byRel[i]);
      assert.equal(items.length, want.length, `${h}: its entities`);
      want.forEach((e, j) => {
        assert.ok(items[j].startsWith(e.name), `${h}: ${e.name} in file order`);
        assert.ok(items[j].includes(KIND[e.kind]), `${e.name}: its kind in words`);
        assert.ok(items[j].includes(e.matters), `${e.name}: what matters`);
      });
    });
    // an empty state reads None (the copy rule, test/dashboard-copy.test.mjs)
    assert.deepEqual(await signalsOf('Local libraries'), ['None']);
    await closePeek();
  });

  // A7: signals in score order, whatever the data's order
  await t.test('A7 signals in score order', async () => {
    await openPeek(EXT, 'Exterior');
    assert.deepEqual(await signalsOf('Independent researchers'), ['Daily visits from the people it serves.', 'How many notes people still keep after a year.']);
    await closePeek();
    // the Acme Storage signals reversed in the data (score 6 before 9): the list still reads 9 first
    const rev = clone(DATA.exterior);
    rev.entities[1].signals.reverse();
    await load({ self: DATA.self, exterior: rev }, '#overview');
    await openPeek(EXT, 'Exterior');
    assert.deepEqual(await signalsOf('Acme Storage'), ['Their storage prices, which set what sync costs.', 'Incidents on their status page.']);
    await closePeek();
    // equal scores keep the data's order, either way round
    for (const order of [[0, 1], [1, 0]]) {
      const tie = clone(DATA.exterior);
      tie.entities[1].signals = order.map((i) => ({ ...DATA.exterior.entities[1].signals[i], score: 9 }));
      await load({ self: DATA.self, exterior: tie }, '#overview');
      await openPeek(EXT, 'Exterior');
      assert.deepEqual(await signalsOf('Acme Storage'), order.map((i) => DATA.exterior.entities[1].signals[i].what), `ties in the data's order ${order}`);
      await closePeek();
    }
  });

  // A8: what the files say is text, never markup
  await t.test('A8 names and words are escaped', async () => {
    const self = clone(DATA.self), ext = clone(DATA.exterior);
    // every field the lists show: the Self's seven, the Exterior's four (relation_word on the other entity)
    self.what = XSS; self.makes = XSS; self.parts[0].name = XSS; self.parts[0].what = XSS; self.parts[1].code[0] = XSS; self.controls[0] = XSS; self.not[0] = XSS;
    ext.entities[0].name = XSS; ext.entities[1].matters = XSS; ext.entities[1].signals[0].what = XSS; ext.entities[7].relation_word = XSS;
    await load({ self, exterior: ext }, '#overview');
    for (const [file, title, n] of [[SELF, 'Self', 7], [EXT, 'Exterior', 4]]) {
      await openPeek(file, title);
      assert.equal(await p.ev("document.querySelectorAll('#drawer-body img').length"), 0, `${title}: no img element`);
      assert.equal(await md(`m.textContent.split(${JSON.stringify(XSS)}).length - 1`), n, `${title}: the literal text shows`);
      await closePeek();
    }
    assert.deepEqual(await p.ev('window.__errors'), []);
  });

  // A9: not drafted yet (null), none drawn, and a server that does not carry the blocks
  await t.test('A9 not drafted yet', async () => {
    await load({ self: null, exterior: null }, '#overview');
    await openPeek(SELF, 'Self');
    assert.ok((await md(`m.textContent.${fold}`)).includes('The Self is not drafted yet: main has no self.md that passes its check.'), 'Self: not drafted');
    assert.equal(await md("m.querySelectorAll('h3').length + m.querySelectorAll('code.language-self').length"), 0, 'Self: no lists, no block');
    await closePeek();
    await openPeek(EXT, 'Exterior');
    assert.ok((await md(`m.textContent.${fold}`)).includes('The Exterior is not drafted yet: main has no exterior.md that passes its check.'), 'Exterior: not drafted');
    await closePeek();
    await load({ self: DATA.self, exterior: { entities: [] } }, '#overview');
    await openPeek(EXT, 'Exterior');
    assert.equal(await md("!m.querySelector('code.language-exterior') && !m.querySelector('h3') && [...m.querySelectorAll('p')].some((x) => x.textContent.trim() === 'None')"), true, 'no entities: None in the block\'s place');
    await closePeek();
    await load({}, '#overview', { drop: ['self', 'exterior'] });
    await openPeek(SELF, 'Self');
    assert.equal(await md("!!m.querySelector('code.language-self')"), true, 'no key: the block as code');
    assert.ok(!(await md(`m.textContent.${fold}`)).includes('not drafted yet'), 'no key: not said to be undrafted');
    await closePeek();
    // a listed file main doesn't hold, with exterior null: not drafted yet in place of the read's error
    const gone = 'proj2/exterior.md';
    await load({ self: null, exterior: null }, '#governance', { gov: { files: [...GOV.files, { group: 'project', path: gone, title: 'Exterior', last_change: '—', differs: null, written: true, state: null }] } });
    await soon("!!document.querySelector('#governance [data-tbl=\"gov:project\"] tbody tr')", 'the listing read');
    await openPeek(gone, 'Exterior');
    assert.ok((await md(`m.textContent.${fold}`)).includes('The Exterior is not drafted yet: main has no exterior.md that passes its check.'), 'missing file: not drafted');
    assert.equal(await p.ev("document.querySelectorAll('#drawer-body .err').length"), 0, 'missing file: no error');
    await closePeek();
  });

  // A10: running text in the peek's viewer no wider than the kit's measure token (test/lib/measure.mjs's token('--measure');
  // ruling m-20261121-180022415-supervisor: the token, not a literal 560px)
  await t.test('A10 running text keeps to the measure', async () => {
    await load(FULL, '#overview');
    for (const [file, title] of [[SELF, 'Self'], [EXT, 'Exterior']]) {
      await openPeek(file, title);
      const r = await p.ev(`(() => {
        const m = document.querySelector('#drawer-body .viewer');
        const probe = document.createElement('div');
        probe.style.cssText = 'position:absolute;visibility:hidden;width:var(--measure)';
        document.body.append(probe);
        const ms = probe.getBoundingClientRect().width;
        probe.remove();
        // the whole viewer, not only .md: lists drawn outside it are judged too
        const els = [...m.querySelectorAll('p, li, h3')].filter((e) => !e.closest('[hidden]'));
        // outside .md: a heading not under the element whose max-width is the measure (index.html .md)
        const loose = [...m.querySelectorAll('h3')].filter((h) => !h.closest('.md')).length;
        return { ms, loose, n: m.querySelectorAll('h3 + ul > li').length, wide: els.filter((e) => e.getBoundingClientRect().width > ms + 1).map((e) => Math.round(e.getBoundingClientRect().width) + 'px ' + e.textContent.slice(0, 30)) };
      })()`);
      assert.ok(r.ms > 0, `the measure resolves: ${r.ms}`);
      assert.ok(r.n > 0, `${title}: lists drawn`);
      assert.deepEqual(r.wide, [], `${title}: wider than the measure (${r.ms}px)`);
      // the drawer's text box is about 78ch wide today, as wide as the measure's 78ch override, so width alone can't
      // fail here: the lists must sit in .md, which keeps them to --measure whatever it becomes (560px once the override goes)
      assert.equal(r.loose, 0, `${title}: lists outside .md, which holds the measure`);
      await closePeek();
    }
  });

  // A11: only main's project files get lists: a ref's text and another exterior.md stay as written
  await t.test('A11 only main, only the project', async () => {
    await load(FULL, '#overview');
    await openPeek(SELF, 'Self');
    assert.ok(await md("!!m.querySelector('h3')"), 'the project file at main: lists');
    await closePeek();
    await openPeek(SELF, 'Self', '&ref=main');
    assert.equal(await md("!!m.querySelector('code.language-self') && !m.querySelector('h3')"), true, 'a ref peek: the block as code');
    await closePeek();
    await openPeek('notes/exterior.md', 'exterior.md');
    assert.equal(await md("!!m.querySelector('code.language-exterior') && !m.querySelector('h3')"), true, 'another exterior.md: the block as code');
    await closePeek();
    // proj/exterior.md before any listing: not the project's; once the listing names it in Project: lists, and notes/ still not
    await openPeek('proj/exterior.md', 'Exterior');
    assert.equal(await md("!!m.querySelector('code.language-exterior') && !m.querySelector('h3')"), true, 'proj/exterior.md unlisted: the block as code');
    await closePeek();
    const gov = { files: GOV.files.map((f) => (f.path === EXT ? { ...f, path: 'proj/exterior.md' } : f)) };
    await load(FULL, '#governance', { gov });
    await soon("[...document.querySelectorAll('#governance [data-tbl=\"gov:project\"] tbody tr')].some((r) => r.textContent.includes('proj/exterior.md'))", 'the listing read');
    await openPeek('proj/exterior.md', 'Exterior');
    assert.equal(await md("!m.querySelector('code.language-exterior') && !!m.querySelector('h3')"), true, 'proj/exterior.md listed: lists');
    await closePeek();
    await openPeek(EXT, 'Exterior');
    assert.equal(await md("!!m.querySelector('code.language-exterior') && !m.querySelector('h3')"), true, 'the standard path, once the listing names another: the block as code');
    await closePeek();
    await openPeek('notes/exterior.md', 'exterior.md');
    assert.equal(await md("!!m.querySelector('code.language-exterior') && !m.querySelector('h3')"), true, 'notes/exterior.md, unlisted: the block as code');
    await closePeek();
  });
});
